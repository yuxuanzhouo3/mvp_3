"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted && resolvedTheme === "dark"
  const nextTheme = isDark ? "light" : "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-11 w-11 rounded-full border-slate-200/80 bg-white/95 p-0 text-slate-900 shadow-[0_10px_26px_rgba(15,23,42,0.08)] backdrop-blur-md transition-colors hover:bg-white dark:border-slate-700 dark:bg-slate-950/82 dark:text-slate-100 dark:shadow-[0_12px_28px_rgba(2,6,23,0.28)] dark:hover:bg-slate-900"
      onClick={() => setTheme(nextTheme)}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-700 dark:text-amber-400" />
      ) : (
        <Moon className="h-4 w-4 text-slate-700 dark:text-slate-100" />
      )}
    </Button>
  )
}
