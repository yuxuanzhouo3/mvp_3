"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Link2,
  MapPin,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"

import { AuthPanel } from "@/components/auth-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VoiceSearchButton } from "@/components/voice-search-button"
import { buildResultsUrl } from "@/lib/price-compare"

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

type StoredAccount = AuthUser & {
  password: string
}

const ACCOUNTS_STORAGE_KEY = "pricecompare.accounts"
const CURRENT_ACCOUNT_STORAGE_KEY = "pricecompare.current-account-id"

const quickKeywords = ["iPhone 16", "华为 Mate 70", "显卡", "咖啡机", "羽绒服", "电动牙刷"]

const featureCards = [
  {
    title: "实时抓取",
    description: "搜索时直接拉取平台最新结果，不依赖固定 mock 数据。",
    icon: Clock3,
  },
  {
    title: "保留筛选",
    description: "结果页继续支持价格区间、排序和平台筛选。",
    icon: SlidersHorizontal,
  },
  {
    title: "风控降级",
    description: "遇到拦截时明确提示，不伪造价格或同款判断。",
    icon: ShieldAlert,
  },
] as const

function isUserPlan(value: unknown): value is UserPlan {
  return value === "free" || value === "registered" || value === "pro"
}

function sanitizeAccount(account: StoredAccount): AuthUser {
  const { password: _password, ...publicAccount } = account
  return publicAccount
}

function parseStoredAccounts(rawValue: string | null): StoredAccount[] {
  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return []
      }

      const candidate = item as Partial<StoredAccount>
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.email !== "string" ||
        typeof candidate.name !== "string" ||
        !isUserPlan(candidate.plan) ||
        typeof candidate.password !== "string" ||
        typeof candidate.freeTrialsUsed !== "number" ||
        typeof candidate.maxFreeTrials !== "number" ||
        typeof candidate.registeredAt !== "string"
      ) {
        return []
      }

      return [
        {
          id: candidate.id,
          email: candidate.email,
          name: candidate.name,
          plan: candidate.plan,
          password: candidate.password,
          freeTrialsUsed: candidate.freeTrialsUsed,
          maxFreeTrials: candidate.maxFreeTrials,
          registeredAt: candidate.registeredAt,
          lastLoginAt: typeof candidate.lastLoginAt === "string" ? candidate.lastLoginAt : undefined,
        },
      ]
    })
  } catch {
    return []
  }
}

function buildAccountId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `account-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getPlanLabel(plan: UserPlan) {
  switch (plan) {
    case "free":
      return "免费版"
    case "registered":
      return "已注册"
    case "pro":
      return "专业版"
    default:
      return "账号"
  }
}

export default function HomePage() {
  const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>([])
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null)
  const [hasHydrated, setHasHydrated] = useState(false)
  const [query, setQuery] = useState("")
  const [voiceStatus, setVoiceStatus] = useState("语音输入图标已预留，支持时可直接说出商品名称。")

  useEffect(() => {
    const nextAccounts = parseStoredAccounts(window.localStorage.getItem(ACCOUNTS_STORAGE_KEY))
    const nextCurrentAccountId = window.localStorage.getItem(CURRENT_ACCOUNT_STORAGE_KEY)

    setStoredAccounts(nextAccounts)
    setCurrentAccountId(nextAccounts.some((account) => account.id === nextCurrentAccountId) ? nextCurrentAccountId : null)
    setHasHydrated(true)
  }, [])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }

    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(storedAccounts))

    if (currentAccountId) {
      window.localStorage.setItem(CURRENT_ACCOUNT_STORAGE_KEY, currentAccountId)
    } else {
      window.localStorage.removeItem(CURRENT_ACCOUNT_STORAGE_KEY)
    }
  }, [currentAccountId, hasHydrated, storedAccounts])

  const savedAccounts = useMemo(() => storedAccounts.map(sanitizeAccount), [storedAccounts])
  const currentUser = useMemo(
    () => savedAccounts.find((account) => account.id === currentAccountId) ?? null,
    [currentAccountId, savedAccounts],
  )

  const handleLogin = ({ email, password }: { email: string; password: string }) => {
    const normalizedEmail = email.trim().toLowerCase()
    const nextPassword = password.trim()

    const matchedAccount = storedAccounts.find((account) => account.email.toLowerCase() === normalizedEmail)
    if (!matchedAccount) {
      return {
        success: false as const,
        message: "这个邮箱还没有注册，请先创建账号。",
      }
    }

    if (matchedAccount.password !== nextPassword) {
      return {
        success: false as const,
        message: "密码不正确，请重新输入。",
      }
    }

    const lastLoginAt = new Date().toISOString()
    setStoredAccounts((current) =>
      current.map((account) => (account.id === matchedAccount.id ? { ...account, lastLoginAt } : account)),
    )
    setCurrentAccountId(matchedAccount.id)

    return {
      success: true as const,
      message: "登录成功。",
    }
  }

  const handleRegister = ({ name, email, password }: { name: string; email: string; password: string }) => {
    const normalizedName = name.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const nextPassword = password.trim()

    if (normalizedName.length < 2) {
      return {
        success: false as const,
        message: "昵称至少需要 2 个字符。",
      }
    }

    if (nextPassword.length < 6) {
      return {
        success: false as const,
        message: "密码至少需要 6 位。",
      }
    }

    if (storedAccounts.some((account) => account.email.toLowerCase() === normalizedEmail)) {
      return {
        success: false as const,
        message: "这个邮箱已经注册过了，请直接登录。",
      }
    }

    const timestamp = new Date().toISOString()
    const nextAccount: StoredAccount = {
      id: buildAccountId(),
      email: normalizedEmail,
      name: normalizedName,
      password: nextPassword,
      plan: "registered",
      freeTrialsUsed: 0,
      maxFreeTrials: 10,
      registeredAt: timestamp,
      lastLoginAt: timestamp,
    }

    setStoredAccounts((current) => [nextAccount, ...current])
    setCurrentAccountId(nextAccount.id)

    return {
      success: true as const,
      message: "注册成功。",
    }
  }

  const handleLogout = () => {
    setCurrentAccountId(null)
  }

  const handleSwitchAccount = (accountId: string) => {
    if (!storedAccounts.some((account) => account.id === accountId)) {
      return
    }

    setCurrentAccountId(accountId)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.16),_transparent_22%),radial-gradient(circle_at_80%_20%,_rgba(16,185,129,0.08),_transparent_22%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_52%,_#f8fafc_100%)] text-slate-950 transition-colors dark:bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.24),_transparent_18%),radial-gradient(circle_at_80%_20%,_rgba(16,185,129,0.10),_transparent_20%),linear-gradient(180deg,_#0f172a_0%,_#111827_50%,_#0f172a_100%)] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.18),_transparent_48%)] dark:bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.24),_transparent_45%)]" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl dark:bg-emerald-500/10" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 flex justify-end">
            <AuthPanel
              user={currentUser}
              savedAccounts={savedAccounts}
              onLogin={handleLogin}
              onRegister={handleRegister}
              onLogout={handleLogout}
              onSwitchAccount={handleSwitchAccount}
            />
          </div>

          <div className="mx-auto max-w-3xl">
            <div className="relative">
              <div className="absolute inset-0 rounded-[36px] bg-[linear-gradient(135deg,rgba(79,70,229,0.16),rgba(100,116,139,0.12),rgba(255,255,255,0.55))] blur-2xl dark:bg-[linear-gradient(135deg,rgba(79,70,229,0.18),rgba(15,23,42,0.24),rgba(16,185,129,0.08))]" />
              <section className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/78 px-5 py-7 shadow-[0_30px_120px_rgba(148,163,184,0.18)] backdrop-blur sm:px-8 sm:py-9 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(19,19,26,0.96),rgba(10,10,14,0.98))] dark:shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
                <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/60 to-transparent dark:via-indigo-300/70" />

                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium tracking-[0.2em] text-indigo-700 uppercase dark:border-indigo-400/30 dark:bg-indigo-500/10 dark:text-indigo-200/80">
                    <Sparkles className="h-3.5 w-3.5" />
                    Smart Shopping
                  </div>

                  <div className="space-y-2">
                    <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl dark:text-white">
                      智能比价，
                      <span className="block bg-gradient-to-r from-indigo-700 via-slate-700 to-indigo-500 bg-clip-text text-transparent dark:from-indigo-200 dark:via-slate-100 dark:to-indigo-300">
                        一次搜索
                      </span>
                    </h1>
                    <p className="hidden">
                      告诉我你想买什么，系统会从京东和淘宝等平台实时抓取价格，并在结果页继续保留筛选和排序体验。
                    </p>
                  </div>
                </div>

                {false ? (
                  <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-4 text-left shadow-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
                    <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      当前已登录：{currentUser.name}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-emerald-700 dark:text-emerald-100/80">
                      邮箱 {currentUser.email}，当前套餐 {getPlanLabel(currentUser.plan)}，免费试用 {currentUser.freeTrialsUsed}/
                      {currentUser.maxFreeTrials}。
                    </div>
                  </div>
                ) : null}

                <form action="/results" className="mx-auto mt-8 max-w-3xl space-y-4">
                  <input type="hidden" name="countries" value="CN" />

                  <label className="block space-y-2 text-center">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-white/40">你想买什么</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-white/30" />
                      <Input
                        name="query"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="例如：iPhone 16、华为手机、显卡、咖啡机"
                        className="h-14 rounded-2xl border-slate-200 bg-white/85 pl-11 pr-16 text-base text-slate-900 placeholder:text-slate-400 focus-visible:border-indigo-400/50 focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/30"
                        required
                      />
                      <VoiceSearchButton
                        onTranscript={setQuery}
                        onStatusChange={setVoiceStatus}
                        className="right-2 top-1/2 -translate-y-1/2 border border-slate-200/80 bg-slate-50/90 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/55 dark:hover:bg-white/[0.09] dark:hover:text-white"
                      />
                    </div>
                  </label>

                  <div className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-white/40">你所在地区</span>
                    <div className="flex h-14 items-center rounded-2xl border border-slate-200 bg-white/85 px-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80">
                      <MapPin className="mr-3 h-4 w-4 text-slate-400 dark:text-white/30" />
                      <span>中国大陆</span>
                      <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200/90">
                        默认搜索区域
                      </span>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="h-14 w-full rounded-full border border-indigo-300/20 bg-[linear-gradient(90deg,#4338ca_0%,#4f46e5_55%,#6366f1_100%)] text-base font-medium text-white shadow-[0_18px_50px_rgba(79,70,229,0.34)] transition hover:brightness-110"
                  >
                    开始智能比价
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="text-center text-xs leading-6 text-slate-500 dark:text-white/45">{voiceStatus}</p>
                </form>

                <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                  {quickKeywords.map((keyword) => (
                    <Link
                      key={keyword}
                      href={buildResultsUrl({ query: keyword, countries: ["CN"] })}
                      className="rounded-full border border-slate-200 bg-white/72 px-3 py-1.5 text-xs text-slate-600 transition hover:border-indigo-200 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:border-indigo-300/30 dark:hover:bg-white/[0.07] dark:hover:text-white"
                    >
                      {keyword}
                    </Link>
                  ))}
                </div>

                <div className="mx-auto mt-6 max-w-2xl rounded-2xl border border-slate-200 bg-white/72 p-4 text-left dark:border-white/10 dark:bg-white/[0.03]">
                  <Link href="/ai-compare" className="group flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/[0.12] dark:text-indigo-200">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">也可以粘贴商品链接做 AI 反查比价</div>
                      <div className="text-xs leading-6 text-slate-500 dark:text-white/50">
                        支持京东 / 淘宝商品链接，自动去另一平台寻找最接近的同款。
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700 dark:text-white/40 dark:group-hover:text-white/80" />
                  </Link>
                </div>
              </section>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {featureCards.map((feature) => {
                const Icon = feature.icon

                return (
                  <div
                    key={feature.title}
                    className="rounded-3xl border border-slate-200 bg-white/68 p-4 shadow-[0_18px_50px_rgba(148,163,184,0.16)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_18px_60px_rgba(0,0,0,0.25)]"
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-white/[0.05] dark:text-indigo-200">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{feature.title}</div>
                    <div className="mt-2 text-xs leading-6 text-slate-600 dark:text-white/50">{feature.description}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
