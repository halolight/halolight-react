# React 版 API 对接说明

## 概述

本项目支持 **Mock 模式** 和 **真实 API 模式** 两种运行方式,通过环境变量 `VITE_MOCK` 控制。

## 环境配置

### Mock 模式 (开发/演示)

```env
VITE_MOCK=true
VITE_API_URL=/api  # 或留空
```

### 真实 API 模式 (生产/对接后端)

```env
VITE_MOCK=false
VITE_API_URL=http://localhost:3000/api  # 后端 API 地址
```

## 后端 API 规范

### 认证接口

| 接口 | 方法 | 说明 | 请求体 | 响应体 |
|------|------|------|--------|--------|
| `/api/auth/login` | POST | 用户登录 | `{email, password}` | `{accessToken, refreshToken, user}` |
| `/api/auth/register` | POST | 用户注册 | `{email, name, password}` | `{accessToken, refreshToken, user}` |
| `/api/auth/me` | GET | 获取当前用户 | - | `{id, email, name, ..., roles}` |
| `/api/auth/refresh` | POST | 刷新令牌 | `{refreshToken}` | `{accessToken, refreshToken}` |
| `/api/auth/logout` | POST | 退出登录 | - | - |

### 用户状态枚举

```typescript
type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" // 大写
```

### 权限格式

- 后端: `{id, resource, action, description}`
- 前端: `"resource:action"` (如 `"users:view"`)

## 技术实现

### 目录结构

```
src/
├── lib/api/
│   ├── backend-types.ts    # 后端 API 原始类型定义
│   ├── adapters.ts         # 前后端数据格式转换
│   ├── client.ts           # API 客户端 (axios + 拦截器)
│   ├── services.ts         # 业务服务封装
│   └── types.ts            # 前端业务类型
├── stores/
│   └── auth-store.ts       # Zustand 认证状态管理
└── mock/                   # Mock 数据
```

### 核心功能

#### 1. Token 自动刷新

`src/lib/api/client.ts` 实现了完整的 Token 刷新机制:

- 响应拦截器捕获 401 错误
- 自动调用 `/api/auth/refresh` 刷新令牌
- 排队等待刷新完成后重放请求
- 刷新失败后清理 Cookies 并跳转登录页

#### 2. 请求拦截器

自动为所有请求添加 `Authorization: Bearer {token}` 头:

- Mock 模式: 读取 `token` cookie
- 真实模式: 读取 `accessToken` cookie

#### 3. Cookie 管理

| 模式 | Cookie 键名 | 有效期 |
|------|------------|--------|
| Mock | `token` | 记住我: 7天 / 普通: 1天 |
| 真实 | `accessToken` | 7天 |
| 真实 | `refreshToken` | 30天 |

#### 4. 数据适配器

`src/lib/api/adapters.ts` 负责前后端数据格式转换:

- 用户状态: 大写枚举直接透传
- 角色权限: 后端对象数组 → 前端字符串数组
- 多角色用户: 取第一个角色作为主角色
- 分页数据: 后端 `{data, meta}` → 前端 `{list, total}`

### 状态管理 (Zustand)

`src/stores/auth-store.ts` 提供的方法:

| 方法 | Mock 支持 | 真实 API 支持 | 说明 |
|------|-----------|---------------|------|
| `login` | ✅ | ✅ | 登录 |
| `register` | ✅ | ✅ | 注册 |
| `logout` | ✅ | ✅ | 退出 |
| `checkAuth` | ✅ | ✅ | 检查认证状态 |
| `forgotPassword` | ✅ | ✅ | 忘记密码 |
| `resetPassword` | ✅ | ✅ | 重置密码 |
| `switchAccount` | ✅ | ❌ | 切换账号 (仅 Mock) |
| `loadAccounts` | ✅ | ❌ | 加载账号列表 (仅 Mock) |

#### checkAuth 优化

为减少网络请求,`checkAuth` 优先从缓存恢复:

1. 检查 Cookie 中是否有 token
2. 尝试从 `accounts` 缓存匹配 token
3. 缓存命中 → 直接恢复状态
4. 缓存未命中 → 调用 `/api/auth/me`

## 切换模式

### 开发时使用 Mock

1. 设置 `.env.development`:
   ```env
   VITE_MOCK=true
   ```
2. 运行 `pnpm dev`
3. 使用 Mock 账号登录 (见 `src/lib/api/client.ts`)

### 对接真实后端

1. 设置 `.env.production`:
   ```env
   VITE_MOCK=false
   VITE_API_URL=http://localhost:3000/api
   ```
2. 确保后端运行在 `http://localhost:3000`
3. 运行 `pnpm build && pnpm preview`

## 常见问题

### 1. 401 后无限刷新循环

**原因**: 刷新接口 `/api/auth/refresh` 也返回 401

**解决**: 确保刷新接口使用独立的 axios 实例,避免触发拦截器

### 2. 多账号切换失败

**原因**: 真实模式不支持多账号切换

**解决**: 在 UI 中隐藏多账号切换功能,或调用后端多租户 API

### 3. 权限校验失败

**原因**: 前端权限格式 `"resource:action"` 与后端不匹配

**解决**: 检查 `adapters.ts` 中的 `adaptBackendPermissions` 函数

## 测试场景

### Mock 模式

- ✅ 登录 / 注册
- ✅ 多账号切换
- ✅ Token 刷新 (模拟)
- ✅ 退出登录

### 真实 API 模式

- ✅ 登录 / 注册 → 存储 accessToken + refreshToken
- ✅ 请求自动附带 Authorization 头
- ✅ 401 错误 → 自动刷新 token → 重放请求
- ✅ 刷新失败 → 清理 Cookies → 跳转登录
- ✅ 获取当前用户信息 (`/api/auth/me`)
- ✅ 退出登录 → 清理所有 Cookies

## 维护建议

1. **类型定义**: 后端 API 变更时,先更新 `backend-types.ts`
2. **数据适配**: 格式差异在 `adapters.ts` 中处理,保持前端类型稳定
3. **Mock 数据**: 定期同步 Mock 数据与真实 API 响应格式
4. **Cookie 策略**: 生产环境设置 `secure: true, sameSite: 'strict'`
5. **错误处理**: 统一在 `services.ts` 中处理业务错误
6. **UI 适配**: 真实模式下隐藏/禁用多账号切换功能
7. **状态字段**: `AuthState.token` 同时承载 Mock token 和真实 accessToken,注意语义区分

## 安全提示

- 清理 Cookie 会导致需要重新登录(即使 localStorage 中有缓存)
- 真实模式完全依赖 Cookie 存储 token,不要在客户端代码中暴露 refreshToken
- 生产环境建议使用 HTTPS + secure cookie

## 参考文件

- API 客户端: `src/lib/api/client.ts`
- 类型定义: `src/lib/api/backend-types.ts`
- 数据适配: `src/lib/api/adapters.ts`
- 状态管理: `src/stores/auth-store.ts`
- 环境配置: `.env.example`
