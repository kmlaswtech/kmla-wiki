import type { VariantProps } from "class-variance-authority";
import { Link, type LinkProps } from "react-router";

import { cn } from "~/shared/lib/utils";
import { buttonVariants } from "~/shared/ui/button";

type LinkButtonProps = LinkProps & VariantProps<typeof buttonVariants>;

/**
 * 버튼처럼 보이는 링크. 다른 화면으로 가는 동작은 `<button>`이 아니라 링크여야 새 탭으로 열기와
 * 주소 복사가 되고, 화면 낭독기도 "링크"로 읽는다.
 *
 * Base UI의 Button에 `<a>`를 끼우면 역할이 버튼으로 바뀌므로, 모양(`buttonVariants`)만 빌려 온다.
 */
export function LinkButton({
  variant,
  size,
  className,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      {...props}
      className={cn(buttonVariants({ variant, size }), className)}
    />
  );
}
