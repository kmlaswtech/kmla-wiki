import { useState } from "react";

import { setAdminNickname } from "../data/mutations";
import { describeAdminError } from "../model/log";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/** 내 관리자 별명을 정하거나 지운다. 길이와 형식은 서버가 다시 검사한다. */
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
  const unchanged = value.trim() === (nickname ?? "");

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
          maxLength={20}
          placeholder="비우면 별명을 지웁니다"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || unchanged}>
          {pending ? <Spinner /> : null}
          저장
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
