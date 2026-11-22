import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      // Base UI는 중첩 dialog의 backdrop을 기본으로 안 그리는데, 게시물 상세가 불투명 시트라 그 위 dialog가 배경 없이 떠 보인다.
      forceRender
      // blur는 쓰지 않는다: 스크림이 합성 레이어가 되어 모달 페이드 중 Chrome이 1px 가로선을 그린다.
      // 농도는 모드별: light는 background/popover가 모두 순백이라 10%로도 분리되고, dark는 popover가 이미 더 밝아 40%로 뒤 본문만 눌러 준다.
      // 더 올리지 않는 이유는 `forceRender`로 두 겹 겹치기 때문(40% -> 64%).
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 dark:bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  /** 이미지 뷰어(z-60)처럼 z-50보다 높은 층 위에 띄울 때 배경도 함께 올린다. */
  overlayClassName?: string;
}) {
  const popupRef = React.useRef<HTMLDivElement>(null);

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        // 첫 tabbable(닫기 버튼)에 포커스 링이 붙지 않게 팝업 자신으로 보낸다. `false`로 끄면 inert 트랩 안에 갈 곳이 없다.
        ref={popupRef}
        initialFocus={popupRef}
        // 머리 부분(`DialogHeader`)이 닫기 단추 자리를 비우는 데 쓴다.
        data-close-button={showCloseButton ? "" : undefined}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // 폰·패드에서는 화면 위쪽에 붙인다. 가운데에 두면 입력란을 누를 때 올라오는 키보드가 아래 단추를 가린다.
          "max-sm:top-4 max-sm:translate-y-0 coarse:sm:top-16 coarse:sm:max-h-[calc(100dvh-5rem)] coarse:sm:translate-y-0",
          className,
        )}
        {...props}
      >
        {/* 화면보다 길면 안쪽만 스크롤한다. 닫기 단추는 바깥 틀에 있어 스크롤해도 제자리에 남는다. */}
        <div className="grid min-h-0 gap-6 overflow-y-auto p-6">{children}</div>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-popover"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-2",
        // 닫기 단추(`top-4 right-4`)는 본문 여백(`p-6`)보다 안쪽까지 온다. 긴 제목·설명이 그 밑에
        // 깔리지 않게 단추 폭만큼 비운다. 손가락 화면에서는 단추가 한 단계 크다.
        "in-data-[close-button]:pr-8 coarse:in-data-[close-button]:pr-10",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
