"use client"

import type React from "react"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  DollarSign,
  LogIn,
  LogOut,
  RefreshCcw,
  Sparkles,
  UserIcon,
  UserPlus,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"

type UserPlan = "free" | "registered" | "pro"

type AuthUser = {
  id: string
  email: string
  name: string
  plan: UserPlan
  freeTrialsUsed: number
  maxFreeTrials: number
  registeredAt: string
  lastLoginAt?: string
}

type AuthActionResult =
  | {
      success: true
      message?: string
    }
  | {
      success: false
      message: string
    }

type AuthPanelView = "guest" | "menu" | "login" | "register" | "switch"

type AuthPanelProps = {
  user: AuthUser | null
  savedAccounts: AuthUser[]
  onLogin: (payload: { email: string; password: string }) => AuthActionResult
  onRegister: (payload: { name: string; email: string; password: string }) => AuthActionResult
  onLogout: () => void
  onSwitchAccount: (accountId: string) => void
}

function getUserPlanLabel(plan: UserPlan) {
  switch (plan) {
    case "free":
      return "免费"
    case "registered":
      return "已注册"
    case "pro":
      return "专业版"
    default:
      return "会员"
  }
}

export function AuthPanel({ user, savedAccounts, onLogin, onRegister, onLogout, onSwitchAccount }: AuthPanelProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelView, setPanelView] = useState<AuthPanelView>(user ? "menu" : "guest")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [panelNotice, setPanelNotice] = useState("")

  const sortedAccounts = useMemo(() => {
    return [...savedAccounts].sort((a, b) => {
      if (a.id === user?.id) return -1
      if (b.id === user?.id) return 1

      return (b.lastLoginAt ?? b.registeredAt).localeCompare(a.lastLoginAt ?? a.registeredAt)
    })
  }, [savedAccounts, user?.id])

  const currentName = user?.name?.trim() || user?.email?.split("@")[0] || "账号"
  const currentAvatarText = currentName.slice(0, 1).toUpperCase()

  const resetForm = () => {
    setEmail("")
    setPassword("")
    setName("")
    setErrorMessage("")
  }

  const clearPanelFeedback = () => {
    setErrorMessage("")
    setPanelNotice("")
  }

  const handlePanelOpenChange = (open: boolean) => {
    setIsPanelOpen(open)

    if (!open) {
      clearPanelFeedback()
      resetForm()
      setPanelView(user ? "menu" : "guest")
    }
  }

  const openPanel = (view: AuthPanelView) => {
    clearPanelFeedback()
    setPanelView(view)
    setIsPanelOpen(true)
  }

  const openAuthMode = (mode: "login" | "register") => {
    clearPanelFeedback()
    setPanelView(mode)
    setIsPanelOpen(true)
  }

  const goBackToMenu = () => {
    clearPanelFeedback()
    setPanelView(user ? "menu" : "guest")
  }

  useEffect(() => {
    if (!isPanelOpen) {
      setPanelView(user ? "menu" : "guest")
    }
  }, [isPanelOpen, user])

  const handleLogoutClick = () => {
    onLogout()
    clearPanelFeedback()
    resetForm()
    setPanelView("guest")
    setIsPanelOpen(false)
  }

  const handleLoginSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const result = onLogin({ email, password })
    if (!result.success) {
      setErrorMessage(result.message)
      return
    }

    resetForm()
    setIsPanelOpen(false)
  }

  const handleRegisterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const result = onRegister({ name, email, password })
    if (!result.success) {
      setErrorMessage(result.message)
      return
    }

    resetForm()
    setIsPanelOpen(false)
  }

  const handleSwitchAccountClick = (accountId: string) => {
    onSwitchAccount(accountId)
    clearPanelFeedback()
    resetForm()
    setPanelView("menu")
    setIsPanelOpen(false)
  }

  const renderMenuCard = ({
    icon,
    title,
    description,
    onClick,
    highlighted = false,
    destructive = false,
  }: {
    icon: React.ReactNode
    title: string
    description?: string
    onClick: () => void
    highlighted?: boolean
    destructive?: boolean
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${
        highlighted
          ? "border-transparent bg-[linear-gradient(135deg,#4338ca_0%,#4f46e5_100%)] text-white shadow-[0_18px_42px_rgba(79,70,229,0.34)] hover:opacity-95"
          : destructive
            ? "border-red-200 bg-white text-red-600 shadow-[0_10px_28px_rgba(15,23,42,0.06)] hover:border-red-300 hover:bg-red-50 dark:border-red-500/30 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
            : "border-slate-200 bg-white text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_16px_36px_rgba(79,70,229,0.14)] dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:hover:border-indigo-500/40"
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          highlighted
            ? "bg-white/15 text-white"
            : destructive
              ? "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{title}</span>
      </span>
    </button>
  )

  const renderAuthForm = (mode: "login" | "register") => {
    const isLoginMode = mode === "login"

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={goBackToMenu}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>

        <div className="rounded-[28px] bg-slate-50 px-5 py-6 dark:bg-slate-900/80">
          <div className="text-sm font-medium uppercase tracking-[0.24em] text-indigo-600 dark:text-indigo-300">
            {isLoginMode ? "Sign In" : "Sign Up"}
          </div>
          <h3 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {isLoginMode ? "登录账号" : "创建新账号"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {isLoginMode
              ? "输入邮箱和密码，继续使用当前比价体验。"
              : "注册后可保存账号、切换身份，并保留后续免费试用进度。"}
          </p>
        </div>

        <form onSubmit={isLoginMode ? handleLoginSubmit : handleRegisterSubmit} className="space-y-4">
          {!isLoginMode ? (
            <Input
              type="text"
              placeholder="请输入昵称"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="h-12 rounded-2xl border-slate-200 bg-slate-50 px-4 text-base dark:border-slate-800 dark:bg-slate-900"
            />
          ) : null}

          <Input
            type="email"
            placeholder="请输入邮箱地址"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="h-12 rounded-2xl border-slate-200 bg-slate-50 px-4 text-base dark:border-slate-800 dark:bg-slate-900"
          />

          <Input
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="h-12 rounded-2xl border-slate-200 bg-slate-50 px-4 text-base dark:border-slate-800 dark:bg-slate-900"
          />

          {errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
              {errorMessage}
            </div>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full rounded-2xl border-0 bg-[linear-gradient(135deg,#4338ca_0%,#4f46e5_100%)] text-base text-white shadow-[0_18px_42px_rgba(79,70,229,0.34)] hover:opacity-95"
          >
            {isLoginMode ? (user ? "登录并切换账号" : "立即登录") : user ? "注册并切换新账号" : "注册并开始使用"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            clearPanelFeedback()
            setPanelView(isLoginMode ? "register" : "login")
          }}
          className="w-full text-center text-sm text-slate-500 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300"
        >
          {isLoginMode ? "还没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    )
  }

  return (
    <Sheet open={isPanelOpen} onOpenChange={handlePanelOpenChange}>
      <Button
        type="button"
        variant="outline"
        onClick={() => openPanel(user ? "menu" : "guest")}
        className="h-11 rounded-full border-slate-200/80 bg-white/88 px-2 pr-3 text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.08)] backdrop-blur-md transition-colors hover:bg-white dark:border-slate-700 dark:bg-slate-900/82 dark:text-slate-100 dark:shadow-[0_12px_28px_rgba(2,6,23,0.22)] dark:hover:bg-slate-900"
      >
        {user ? (
          <span className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4338ca_0%,#4f46e5_100%)] text-xs font-semibold text-white shadow-[0_10px_22px_rgba(79,70,229,0.28)]">
              {currentAvatarText}
            </span>
            <span className="max-w-[88px] truncate text-sm font-medium text-slate-900 dark:text-white sm:max-w-[112px]">{currentName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </span>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium">
            <LogIn className="h-4 w-4" />
            登录/注册
          </span>
        )}
      </Button>

      <SheetContent
        side="right"
        className="w-full gap-0 border-l-0 bg-white p-0 sm:max-w-[430px] dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200/80 px-6 pb-5 pt-7 dark:border-slate-800">
            <SheetTitle className="text-center text-[2rem] font-semibold tracking-tight text-slate-950 dark:text-white">
              Menu
            </SheetTitle>
            <SheetDescription className="sr-only">账号登录、注册与切换菜单</SheetDescription>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
            {panelView === "guest" ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  {renderMenuCard({
                    icon: <LogIn className="h-5 w-5" />,
                    title: "登录已有账号",
                    description: "继续使用已保存的邮箱账号",
                    onClick: () => openAuthMode("login"),
                  })}
                  {renderMenuCard({
                    icon: <UserPlus className="h-5 w-5" />,
                    title: "注册新账号",
                    description: "创建账号并保存当前使用记录",
                    onClick: () => openAuthMode("register"),
                    highlighted: true,
                  })}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  注册后可保存账号、继续比价，并在同一浏览器里快速切换不同用户。
                </div>
              </div>
            ) : null}

            {panelView === "menu" && user ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 rounded-[28px] bg-slate-50 px-5 py-5 dark:bg-slate-900/80">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4338ca_0%,#4f46e5_100%)] text-2xl font-semibold text-white shadow-[0_18px_42px_rgba(79,70,229,0.3)]">
                    {currentAvatarText}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-slate-950 dark:text-white">{user.name}</div>
                    <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{user.email}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge className="rounded-full bg-slate-900/5 px-3 py-1 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                        {getUserPlanLabel(user.plan)}
                      </Badge>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        免费试用 {user.freeTrialsUsed}/{user.maxFreeTrials}
                      </span>
                    </div>
                  </div>
                </div>

                {panelNotice ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
                    {panelNotice}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {renderMenuCard({
                    icon: <UserIcon className="h-5 w-5" />,
                    title: "个人信息",
                    description: "查看当前登录身份",
                    onClick: () => setPanelNotice(`当前账号为 ${user.name}，登录邮箱是 ${user.email}。`),
                  })}
                  {renderMenuCard({
                    icon: <Sparkles className="h-5 w-5" />,
                    title: "订阅管理",
                    description: "查看套餐与试用次数",
                    onClick: () =>
                      setPanelNotice(
                        `当前套餐是${getUserPlanLabel(user.plan)}，免费试用已使用 ${user.freeTrialsUsed}/${user.maxFreeTrials} 次。`,
                      ),
                  })}
                  {renderMenuCard({
                    icon: <DollarSign className="h-5 w-5" />,
                    title: "支付记录",
                    description: "当前演示环境暂无支付记录",
                    onClick: () => setPanelNotice("当前为本地演示环境，支付记录模块暂未接入。"),
                  })}
                  {renderMenuCard({
                    icon: <Zap className="h-5 w-5" />,
                    title: "升级Pro",
                    description: "保留模板中的主行动号召样式",
                    onClick: () => setPanelNotice("升级 Pro 的支付链路暂未接入，这里先按模板保留入口样式。"),
                    highlighted: true,
                  })}
                  {renderMenuCard({
                    icon: <RefreshCcw className="h-5 w-5" />,
                    title: "切换账号",
                    description: "从已保存账号中快速切换",
                    onClick: () => openPanel("switch"),
                  })}
                  {renderMenuCard({
                    icon: <LogOut className="h-5 w-5" />,
                    title: "退出登录",
                    description: "退出当前账号并回到未登录状态",
                    onClick: handleLogoutClick,
                    destructive: true,
                  })}
                </div>
              </div>
            ) : null}

            {panelView === "switch" && user ? (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={goBackToMenu}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回
                </button>

                <div className="space-y-3">
                  {sortedAccounts.length > 0 ? (
                    sortedAccounts.map((account) => {
                      const isCurrent = account.id === user.id
                      const avatarLabel = (account.name?.trim() || account.email || "A").slice(0, 1).toUpperCase()

                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => handleSwitchAccountClick(account.id)}
                          disabled={isCurrent}
                          className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                            isCurrent
                              ? "cursor-default border-indigo-200 bg-indigo-50 dark:border-indigo-400/30 dark:bg-indigo-500/10"
                              : "border-slate-200 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_16px_36px_rgba(79,70,229,0.14)] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40"
                          }`}
                        >
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4338ca_0%,#4f46e5_100%)] font-semibold text-white">
                            {avatarLabel}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-semibold text-slate-900 dark:text-white">{account.name}</span>
                              <Badge variant="outline" className="rounded-full">
                                {getUserPlanLabel(account.plan)}
                              </Badge>
                              {isCurrent ? <Badge className="rounded-full bg-indigo-600 text-white">当前账号</Badge> : null}
                            </span>
                            <span className="mt-1 block truncate text-sm text-slate-500 dark:text-slate-400">{account.email}</span>
                            <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">
                              免费试用 {account.freeTrialsUsed}/{account.maxFreeTrials}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      暂无已保存账号，请先注册或登录其他账号。
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openAuthMode("login")}
                    className="h-12 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    登录其他账号
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openAuthMode("register")}
                    className="h-12 rounded-2xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    注册新账号
                  </Button>
                </div>
              </div>
            ) : null}

            {panelView === "login" ? renderAuthForm("login") : null}
            {panelView === "register" ? renderAuthForm("register") : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
