import { useState } from "react";

import { setAdminNickname } from "../data/mutations";
import { describeAdminError } from "../model/log";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/** 서버(`btrim`)처럼 앞뒤의 ASCII 공백만 지운다. 다른 공백은 서버가 거절한다. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/** 내 관리자 별명을 정하거나 지운다. 형식은 서버가 검사한다. */
export function AdminNicknameForm({
  nickname,
  onChanged,
}: {
  nickname: string | null;
  onChanged: () => void;
}) {
  const [value, setValue] = useState(nickname ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = trimSpaces(value);
  const unchanged = trimmed === (nickname ?? "");
  // 서버의 `char_length`처럼 코드 포인트로 센다. `maxLength`는 UTF-16 단위라 쓰지 않는다.
  const tooLong = [...trimmed].length > 20;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await setAdminNickname(value);
      onChanged();
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="mt-3 grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="admin-nickname">내 별명 (관리자에게만 표시)</Label>
      <div className="flex gap-2">
        <Input
          id="admin-nickname"
          value={value}
          aria-invalid={tooLong}
          placeholder="비우면 별명을 지웁니다"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || unchanged || tooLong}
        >
          {pending ? <Spinner /> : null}
          저장
        </Button>
      </div>
      {tooLong ? (
        <p className="text-sm text-destructive">
          별명은 20자까지 쓸 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
