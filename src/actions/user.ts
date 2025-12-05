import type { User } from "@/lib/api/types"

const API_BASE = import.meta.env.VITE_API_URL || "/api"

// ============================================================================
// 类型定义
// ============================================================================

export interface ActionResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

export interface LoginFormData {
  email: string
  password: string
  remember?: boolean
}

export interface UserFormData {
  name: string
  email: string
  roleId?: string
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED"
  avatar?: string
  phone?: string
  department?: string
  position?: string
  bio?: string
}

// ============================================================================
// 辅助函数
// ============================================================================

function getToken(): string | null {
  return localStorage.getItem("token")
}

function setToken(token: string, remember?: boolean): void {
  localStorage.setItem("token", token)
  if (remember) {
    localStorage.setItem("token_remember", "true")
  }
}

function removeToken(): void {
  localStorage.removeItem("token")
  localStorage.removeItem("token_remember")
}

async function clientFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  })

  const data = await response.json()

  if (data.code !== 200 && data.code !== 0) {
    throw new Error(data.message || "请求失败")
  }

  return data.data
}

// ============================================================================
// 认证相关 Actions
// ============================================================================

/**
 * 用户登录
 */
export async function loginAction(
  formData: LoginFormData
): Promise<ActionResult<{ user: User; token: string }>> {
  try {
    const result = await clientFetch<{ user: User; token: string }>(
      "/user/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      }
    )

    // 设置 token 到 localStorage
    setToken(result.token, formData.remember)

    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "登录失败",
    }
  }
}

/**
 * 用户登出
 */
export async function logoutAction(): Promise<ActionResult> {
  try {
    removeToken()
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "登出失败",
    }
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUserAction(): Promise<ActionResult<User>> {
  try {
    const user = await clientFetch<User>("/user/current")
    return { success: true, data: user }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "获取用户信息失败",
    }
  }
}

// ============================================================================
// 用户管理 Actions
// ============================================================================

/**
 * 获取用户列表
 */
export async function getUsersAction(params?: {
  page?: number
  pageSize?: number
  keyword?: string
}): Promise<ActionResult<{ list: User[]; total: number }>> {
  try {
    const query = new URLSearchParams(
      Object.entries(params || {}).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) acc[key] = String(value)
          return acc
        },
        {} as Record<string, string>
      )
    ).toString()

    const result = await clientFetch<{ list: User[]; total: number }>(
      `/users${query ? `?${query}` : ""}`
    )

    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "获取用户列表失败",
    }
  }
}

/**
 * 创建用户
 */
export async function createUserAction(
  formData: UserFormData
): Promise<ActionResult<User>> {
  try {
    const user = await clientFetch<User>("/users", {
      method: "POST",
      body: JSON.stringify(formData),
    })

    return { success: true, data: user }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "创建用户失败",
    }
  }
}

/**
 * 更新用户
 */
export async function updateUserAction(
  id: string,
  formData: Partial<UserFormData>
): Promise<ActionResult<User>> {
  try {
    const user = await clientFetch<User>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(formData),
    })

    return { success: true, data: user }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新用户失败",
    }
  }
}

/**
 * 删除用户
 */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  try {
    await clientFetch<void>(`/users/${id}`, {
      method: "DELETE",
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "删除用户失败",
    }
  }
}

/**
 * 批量删除用户
 */
export async function batchDeleteUsersAction(
  ids: string[]
): Promise<ActionResult> {
  try {
    await clientFetch<void>("/users/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "批量删除失败",
    }
  }
}

/**
 * 更新用户状态
 */
export async function updateUserStatusAction(
  id: string,
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED"
): Promise<ActionResult<User>> {
  try {
    const user = await clientFetch<User>(`/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    })

    return { success: true, data: user }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "更新状态失败",
    }
  }
}
