"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A small hover/focus text popup. Self-contained: `Tooltip` brings its own provider, so a caller wraps just the
 * element and passes the text. z-[60] so it also shows above a Dialog (z-50) it sits inside.
 */
function Tooltip({
  content,
  children,
  side = "top",
  delayDuration = 150,
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: "top" | "right" | "bottom" | "left"
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            data-slot="tooltip-content"
            className={cn(
              "z-[60] max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-md break-words"
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export { Tooltip }
