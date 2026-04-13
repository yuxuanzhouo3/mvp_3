"use client"

import { useEffect, useRef, useState } from "react"
import { Mic } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type BrowserSpeechRecognitionResult = {
  0?: {
    transcript?: string
  }
}

type BrowserSpeechRecognitionEvent = {
  results?: ArrayLike<BrowserSpeechRecognitionResult>
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition
  }
}

type VoiceSearchButtonProps = {
  onTranscript: (value: string) => void
  onStatusChange?: (value: string) => void
  className?: string
}

export function VoiceSearchButton({ onTranscript, onStatusChange, className }: VoiceSearchButtonProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [statusText, setStatusText] = useState("语音搜索入口已预留，点击麦克风可开始语音输入。")

  useEffect(() => {
    onStatusChange?.(statusText)
  }, [onStatusChange, statusText])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setIsSupported(false)
      setStatusText("当前浏览器暂不支持 Web Speech API，语音输入入口已保留。")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = typeof navigator !== "undefined" ? navigator.language : "zh-CN"
    recognition.onstart = () => {
      setIsListening(true)
      setStatusText("正在聆听，请说出商品名称。")
    }
    recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
      const transcript = Array.from(event.results ?? [])
        .map((result) => result?.[0]?.transcript ?? "")
        .join("")
        .trim()

      if (transcript) {
        onTranscript(transcript)
        setStatusText(`已识别：${transcript}`)
      }
    }
    recognition.onerror = (event: { error?: string }) => {
      setIsListening(false)

      if (event.error === "not-allowed") {
        setStatusText("麦克风权限被拒绝，请允许访问后重试。")
        return
      }

      if (event.error === "no-speech") {
        setStatusText("没有检测到语音，请再试一次。")
        return
      }

      setStatusText("语音搜索暂时不可用，请稍后重试。")
    }
    recognition.onend = () => {
      setIsListening(false)
      setStatusText((current) =>
        current.startsWith("已识别：") ? "语音输入完成，可继续手动修改关键词。" : "语音输入已停止，点击麦克风可再次尝试。",
      )
    }

    recognitionRef.current = recognition
    setIsSupported(true)
    setStatusText("语音搜索入口已预留，点击麦克风可开始语音输入。")

    return () => {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      if (recognition.abort) {
        recognition.abort()
      } else {
        recognition.stop()
      }
      recognitionRef.current = null
    }
  }, [onTranscript])

  const handleClick = () => {
    const recognition = recognitionRef.current
    if (!recognition) {
      return
    }

    if (isListening) {
      recognition.stop()
      return
    }

    try {
      recognition.lang = typeof navigator !== "undefined" ? navigator.language : recognition.lang
      recognition.start()
    } catch {
      setStatusText("语音识别正在初始化，请稍后再试。")
    }
  }

  return (
    <Button
      type="button"
      variant={isListening ? "default" : "ghost"}
      size="icon"
      className={cn(
        "absolute top-2 h-10 w-10 rounded-full",
        isListening ? "bg-red-500 text-white hover:bg-red-500/90" : "text-gray-500 hover:text-indigo-600",
        className,
      )}
      onClick={handleClick}
      aria-label={isListening ? "停止语音搜索" : "开始语音搜索"}
      aria-pressed={isListening}
      title={isSupported ? statusText : "当前浏览器暂不支持 Web Speech API。"}
      disabled={!isSupported}
    >
      <Mic className={`h-4 w-4 ${isListening ? "animate-pulse" : ""}`} />
    </Button>
  )
}
