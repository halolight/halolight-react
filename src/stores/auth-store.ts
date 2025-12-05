import Cookies from "js-cookie"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type {
  AccountWithToken,
  LoginRequest,
  RegisterRequest,
} from "@/lib/api/client"
import { authApi } from "@/lib/api/client"

interface AuthState {
  user: AccountWithToken | null
  accounts: AccountWithToken[]
  activeAccountId: string | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null

  // Actions
  login: (data: LoginRequest) => Promise<void>
  register: (data: RegisterRequest) => Promise<void>
  logout: () => Promise<void>
  switchAccount: (accountId: string) => Promise<void>
  loadAccounts: () => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (token: string, password: string) => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
}

const cookieOptions = (days = 1) => ({
  expires: days,
  secure: import.meta.env.NODE_ENV === "production",
  sameSite: "strict" as const,
})

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accounts: [],
      activeAccountId: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
      error: null,

      login: async (data: LoginRequest) => {
        set({ isLoading: true, error: null })
        try {
          const response = await authApi.login(data)

          // authApi.login 已设置对应的 cookie:
          // - Mock 模式: 设置 "token" cookie
          // - 真实模式: 设置 "accessToken" 和 "refreshToken" cookies
          // 这里 state.token 在两种模式下都存储主 token 值(Mock 为 token, 真实为 accessToken)
          const IS_MOCK = import.meta.env.VITE_MOCK === "true"
          if (IS_MOCK) {
            // Mock 模式需要额外设置 token cookie (authApi 已设置,这里为兼容保留)
            Cookies.set("token", response.token, cookieOptions(data.remember ? 7 : 1))
          }
          // 真实模式下 authApi.login 已设置 accessToken + refreshToken,无需重复

          set({
            user: response.user,
            token: response.token, // 存储主 token 值用于状态管理
            accounts: response.accounts,
            activeAccountId: response.user.id,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "登录失败",
            isLoading: false,
          })
          throw error
        }
      },

      register: async (data: RegisterRequest) => {
        set({ isLoading: true, error: null })
        try {
          const response = await authApi.register(data)

          // authApi.register 已设置对应的 cookie
          const IS_MOCK = import.meta.env.VITE_MOCK === "true"
          if (IS_MOCK) {
            Cookies.set("token", response.token, cookieOptions())
          }
          // 真实模式下已在 authApi.register 中设置 accessToken + refreshToken

          set({
            user: response.user,
            token: response.token,
            accounts: response.accounts,
            activeAccountId: response.user.id,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "注册失败",
            isLoading: false,
          })
          throw error
        }
      },

      logout: async () => {
        set({ isLoading: true })
        try {
          await authApi.logout()
        } finally {
          // 清理所有可能的 token cookies
          Cookies.remove("token")
          Cookies.remove("accessToken")
          Cookies.remove("refreshToken")
          set({
            user: null,
            token: null,
            accounts: [],
            activeAccountId: null,
            isAuthenticated: false,
            isLoading: false,
          })
        }
      },

      switchAccount: async (accountId: string) => {
        const IS_MOCK = import.meta.env.VITE_MOCK === "true"

        // 真实模式下不支持多账号切换
        if (!IS_MOCK) {
          const error = "真实模式下暂不支持多账号切换,需要后端 API 支持"
          set({ error })
          throw new Error(error)
        }

        const account = get().accounts.find((item) => item.id === accountId)
        if (!account) {
          set({ error: "账号不存在" })
          throw new Error("账号不存在")
        }

        // Mock 模式下切换账号
        Cookies.set("token", account.token, cookieOptions(7))
        set({
          user: account,
          token: account.token,
          activeAccountId: account.id,
          isAuthenticated: true,
          error: null,
        })
      },

      loadAccounts: async () => {
        const IS_MOCK = import.meta.env.VITE_MOCK === "true"

        // 真实模式下不支持多账号,跳过
        if (!IS_MOCK) {
          set({ isLoading: false })
          return
        }

        set({ isLoading: true })
        try {
          const accounts = await authApi.getAccounts()
          const { activeAccountId, token, user } = get()
          const nextUser =
            accounts.find((acc) => acc.id === activeAccountId) ||
            accounts.find((acc) => acc.token === token) ||
            user ||
            null

          if (nextUser) {
            Cookies.set("token", nextUser.token, cookieOptions(7))
          } else {
            Cookies.remove("token")
          }

          set({
            accounts,
            user: nextUser,
            activeAccountId: nextUser?.id ?? null,
            token: nextUser?.token ?? null,
            isAuthenticated: Boolean(nextUser),
            isLoading: false,
          })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "加载账号失败",
            isLoading: false,
          })
        }
      },

      forgotPassword: async (email: string) => {
        set({ isLoading: true, error: null })
        try {
          await authApi.forgotPassword(email)
          set({ isLoading: false })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "发送失败",
            isLoading: false,
          })
          throw error
        }
      },

      resetPassword: async (token: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          await authApi.resetPassword(token, password)
          set({ isLoading: false })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "重置失败",
            isLoading: false,
          })
          throw error
        }
      },

      checkAuth: async () => {
        // 优先从 accessToken 读取（真实模式），回退到 token（Mock 模式）
        const IS_MOCK = import.meta.env.VITE_MOCK === "true"
        const token = Cookies.get(IS_MOCK ? "token" : "accessToken") || Cookies.get("token")
        const { accounts } = get()

        if (!token) {
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            activeAccountId: null,
            isLoading: false,
          })
          return
        }

        // 尝试从缓存账号恢复（减少网络请求）
        const cachedAccount = accounts.find((acc) => acc.token === token)
        if (cachedAccount) {
          set({
            user: cachedAccount,
            token,
            activeAccountId: cachedAccount.id,
            isAuthenticated: true,
            isLoading: false,
          })
          return
        }

        // 缓存未命中，调用 getCurrentUser 获取最新用户信息
        set({ isLoading: true })
        try {
          const response = await authApi.getCurrentUser()
          if (response?.user) {
            set({
              user: response.user,
              token,
              accounts: response.accounts,
              activeAccountId: response.user.id,
              isAuthenticated: true,
              isLoading: false,
            })
          } else {
            // 清理所有 token cookies
            Cookies.remove("token")
            Cookies.remove("accessToken")
            Cookies.remove("refreshToken")
            set({
              isAuthenticated: false,
              user: null,
              token: null,
              activeAccountId: null,
              accounts: [],
              isLoading: false,
            })
          }
        } catch {
          // 清理所有 token cookies
          Cookies.remove("token")
          Cookies.remove("accessToken")
          Cookies.remove("refreshToken")
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            activeAccountId: null,
            accounts: [],
            isLoading: false,
          })
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
