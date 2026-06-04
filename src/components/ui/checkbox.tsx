"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

function Checkbox({
  className,
  checked,
  onCheckedChange,
  disabled,
  ...props
}: {
  className?: string
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(checked: boolean) => onCheckedChange?.(checked)}
      disabled={disabled}
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded border border-primary/30 bg-background transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-primary-foreground data-[unchecked]:hidden">
        <Check className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
