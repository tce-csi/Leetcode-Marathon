import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-foreground text-background hover:opacity-90",
        secondary: "border border-border-strong bg-surface-2 text-foreground hover:bg-surface-3",
        ghost: "text-muted-strong hover:bg-surface-2 hover:text-foreground",
        danger:
          "border border-foreground bg-transparent text-foreground hover:bg-foreground hover:text-background",
        success: "bg-foreground text-background hover:opacity-90",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-2",
        accent: "bg-foreground text-background hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
      block: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}

export { buttonVariants };
