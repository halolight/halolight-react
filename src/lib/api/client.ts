import axios from "axios"
import type { AxiosError, InternalAxiosRequestConfig } from "axios"
import Cookies from "js-cookie"

import {
  adaptBackendCurrentUserResponse,
  adaptBackendLoginResponse,
} from "./adapters"
import type {
  BackendCurrentUserResponse,
  BackendLoginResponse,
  BackendRefreshTokenResponse,
} from "./backend-types"
import { mockRoles } from "./mock-data"
import type { Role } from "./types"

const IS_MOCK_MODE = import.meta.env.VITE_MOCK === "true"

// Mock 模式使用 Vite 开发服务器代理 /api
// 真实模式使用完整的后端地址（环境变量配置，如 http://localhost:3000/api）
const API_BASE_URL = IS_MOCK_MODE
  ? "/api"
  : import.meta.env.VITE_API_URL || "http://localhost:3000/api"

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
})

// ============================================================================
// Token 刷新机制
// ============================================================================

let isRefreshing = false
let refreshPromise: Promise<BackendRefreshTokenResponse> | null = null

interface PendingRequest {
  resolve: (token: string) => void
  reject: (error: unknown) => void
}
const pendingRequests: PendingRequest[] = []

function enqueueRequest(resolve: (token: string) => void, reject: (error: unknown) => void) {
  pendingRequests.push({ resolve, reject })
}

function flushPendingRequests(error: unknown | null, token?: string) {
  pendingRequests.forEach((request) => {
    if (error) {
      request.reject(error)
    } else if (token) {
      request.resolve(token)
    }
  })
  pendingRequests.length = 0
}

// 清理令牌并跳转登录页
function clearTokensAndRedirect() {
  Cookies.remove("accessToken")
  Cookies.remove("refreshToken")
  if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
    window.location.href = "/login"
  }
}

async function refreshAccessToken(): Promise<BackendRefreshTokenResponse> {
  const refreshToken = Cookies.get("refreshToken")

  if (!refreshToken) {
    throw new Error("No refresh token available")
  }

  try {
    // 使用独立的 axios 实例，避免触发拦截器造成循环
    const response = await axios.post<BackendRefreshTokenResponse>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )

    const { accessToken, refreshToken: newRefreshToken } = response.data

    // 存储新的 tokens
    Cookies.set("accessToken", accessToken, { expires: 7 })
    Cookies.set("refreshToken", newRefreshToken, { expires: 30 })

    return response.data
  } catch (error) {
    // 刷新失败，清除所有 tokens 并跳转登录
    clearTokensAndRedirect()
    throw error
  }
}

// ============================================================================
// 请求拦截器
// ============================================================================

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (IS_MOCK_MODE) {
      const token = Cookies.get("token")
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`
      }
    } else {
      const token = Cookies.get("accessToken")
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  },
  (error: AxiosError) => {
    return Promise.reject(error)
  }
)

// ============================================================================
// 响应拦截器
// ============================================================================

apiClient.interceptors.response.use(
  (response) => {
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // Mock 模式使用旧逻辑
    if (IS_MOCK_MODE) {
      if (error.response?.status === 401) {
        Cookies.remove("token")
        if (typeof window !== "undefined") {
          window.location.href = "/login"
        }
      }
      return Promise.reject(error)
    }

    // 真实 API 模式：实现 token 刷新
    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error)
    }

    if (originalRequest._retry) {
      // 已经尝试过刷新但仍失败，不再重试
      clearTokensAndRedirect()
      return Promise.reject(error)
    }

    originalRequest._retry = true

    if (isRefreshing && refreshPromise) {
      // 正在刷新中，将当前请求加入队列
      return new Promise((resolve, reject) => {
        enqueueRequest(
          (token: string) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`
            }
            resolve(apiClient(originalRequest))
          },
          (err: unknown) => {
            reject(err)
          }
        )
      })
    }

    isRefreshing = true
    refreshPromise = refreshAccessToken()

    try {
      const { accessToken } = await refreshPromise

      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
      }

      flushPendingRequests(null, accessToken)

      return apiClient(originalRequest)
    } catch (refreshError) {
      // 刷新失败，清理所有待处理请求并清除令牌
      flushPendingRequests(refreshError)
      clearTokensAndRedirect()
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
      refreshPromise = null
    }
  }
)

// API 响应类型
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

// 用户相关类型（带权限的账号信息）
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: Role
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED"
  createdAt: string
  lastLoginAt?: string
}

export interface AccountWithToken extends User {
  token: string
}

export interface LoginRequest {
  email: string
  password: string
  remember?: boolean
}

export interface RegisterRequest {
  name: string
  email: string
  password: string
  confirmPassword: string
}

export interface LoginResponse {
  user: AccountWithToken
  token: string
  expiresIn: number
  accounts: AccountWithToken[]
}

export interface CurrentUserResponse {
  user: AccountWithToken
  accounts: AccountWithToken[]
}

// 内置多账号示例（模拟多租户/多角色）
const mockAccounts: AccountWithToken[] = [
  {
    id: "acc-admin",
    email: "admin@halolight.h7ml.cn",
    name: "主账号（管理员）",
    avatar: "/avatars/1.png",
    role: mockRoles[0],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    token: "mock_token_acc-admin",
  },
  {
    id: "acc-ops",
    email: "ops@halolight.h7ml.cn",
    name: "日常运营账号",
    avatar: "/avatars/2.png",
    role: mockRoles[1],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    token: "mock_token_acc-ops",
  },
  {
    id: "acc-editor",
    email: "editor@halolight.h7ml.cn",
    name: "内容编辑账号",
    avatar: "/avatars/3.png",
    role: mockRoles[2],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    token: "mock_token_acc-editor",
  },
]

const buildToken = (accountId: string) => `mock_token_${accountId}`

const findAccountByEmail = (email: string) =>
  mockAccounts.find((account) => account.email === email)

const findAccountByToken = (token: string) =>
  mockAccounts.find((account) => account.token === token)

// ============================================================================
// Mock API 函数（Mock 模式使用）
// ============================================================================

const mockLogin = async (data: LoginRequest): Promise<LoginResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 500))

  const account = findAccountByEmail(data.email)
  if (!account || data.password !== "123456") {
    throw new Error("邮箱或密码错误")
  }

  const token = buildToken(account.id)
  const hydratedAccount: AccountWithToken = { ...account, token }

  // Mock 模式下设置 token 到 Cookie
  Cookies.set("token", token, { expires: 7 })

  return {
    user: hydratedAccount,
    token,
    expiresIn: 86400,
    accounts: mockAccounts.map((item) =>
      item.id === account.id ? hydratedAccount : item
    ),
  }
}

const mockRegister = async (data: RegisterRequest): Promise<LoginResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 500))

  if (data.password !== data.confirmPassword) {
    throw new Error("两次密码输入不一致")
  }

  const accountId = `acc-${Date.now()}`
  const newAccount: AccountWithToken = {
    id: accountId,
    email: data.email,
    name: data.name,
    avatar: "/avatars/4.png",
    role: mockRoles[3],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    token: buildToken(accountId),
  }

  mockAccounts.push(newAccount)

  // Mock 模式下设置 token 到 Cookie
  Cookies.set("token", newAccount.token, { expires: 7 })

  return {
    user: newAccount,
    token: newAccount.token,
    expiresIn: 86400,
    accounts: [...mockAccounts],
  }
}

const mockGetCurrentUser = async (): Promise<CurrentUserResponse | null> => {
  const token = Cookies.get("token")
  if (!token) return null

  const account = findAccountByToken(token)
  if (!account) return null

  return {
    user: account,
    accounts: [...mockAccounts],
  }
}

// ============================================================================
// Auth API
// ============================================================================

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    if (IS_MOCK_MODE) {
      return mockLogin(data)
    }

    // 真实 API 调用
    const response = await apiClient.post<BackendLoginResponse>("/auth/login", {
      email: data.email,
      password: data.password,
    })

    const loginResponse = adaptBackendLoginResponse(response.data)

    // 存储 tokens
    Cookies.set("accessToken", loginResponse.token, { expires: 7 })
    Cookies.set("refreshToken", response.data.refreshToken, { expires: 30 })

    return loginResponse
  },

  register: async (data: RegisterRequest): Promise<LoginResponse> => {
    if (IS_MOCK_MODE) {
      return mockRegister(data)
    }

    // 真实 API 调用
    const response = await apiClient.post<BackendLoginResponse>("/auth/register", {
      email: data.email,
      name: data.name,
      password: data.password,
    })

    const loginResponse = adaptBackendLoginResponse(response.data)

    // 存储 tokens
    Cookies.set("accessToken", loginResponse.token, { expires: 7 })
    Cookies.set("refreshToken", response.data.refreshToken, { expires: 30 })

    return loginResponse
  },

  forgotPassword: async (email: string): Promise<void> => {
    if (IS_MOCK_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.log("发送重置密码邮件到:", email)
      return
    }

    await apiClient.post("/auth/forgot-password", { email })
  },

  resetPassword: async (token: string, password: string): Promise<void> => {
    if (IS_MOCK_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.log("重置密码:", token, password)
      return
    }

    await apiClient.post("/auth/reset-password", { token, password })
  },

  logout: async (): Promise<void> => {
    if (IS_MOCK_MODE) {
      Cookies.remove("token")
      return
    }

    try {
      await apiClient.post("/auth/logout")
    } finally {
      Cookies.remove("accessToken")
      Cookies.remove("refreshToken")
    }
  },

  getCurrentUser: async (): Promise<CurrentUserResponse | null> => {
    if (IS_MOCK_MODE) {
      return mockGetCurrentUser()
    }

    const token = Cookies.get("accessToken")
    if (!token) return null

    try {
      const response = await apiClient.get<BackendCurrentUserResponse>("/auth/me")

      return adaptBackendCurrentUserResponse(response.data)
    } catch (error) {
      // 如果是 401 错误，清理 token 并跳转（拦截器会处理，这里只记录）
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.error("获取当前用户失败: 未授权")
      } else {
        console.error("获取当前用户失败:", error)
      }
      return null
    }
  },

  getAccounts: async (): Promise<AccountWithToken[]> => {
    if (IS_MOCK_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return [...mockAccounts]
    }

    // 真实 API 暂不支持多账号
    return []
  },
}

export default apiClient
