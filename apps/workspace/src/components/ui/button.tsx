import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
  {
    variants: {
      variant: {
        default: "bg-neutral-900 text-white hover:bg-neutral-700",
        outline: "border border-neutral-200 bg-white hover:bg-neutral-100",
        ghost: "hover:bg-neutral-100",
        danger: "bg-red-700 text-white hover:bg-red-800",
      },
      size: { default: "min-h-9 px-3 py-2", icon: "h-9 w-9 shrink-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
interface Props
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(variants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
