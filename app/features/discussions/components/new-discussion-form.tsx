import { useState } from "react";
import { Form, Link } from "react-router";

import { DISCUSSION_FIELD } from "../model/form";
import { DISCUSSION_LIMIT, postLength } from "../model/rules";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

/** 새 토론 열기. 판에 붙일 때는 그 판을 보여 주고, 떼는 링크를 둔다. */
export function NewDiscussionForm({
  revisionId,
  revisionHref,
  unpinHref,
  isAdmin,
  pending,
  error,
  onCancel,
}: {
  revisionId: number | null;
  revisionHref: (revisionId: number) => string;
  /** 판에서 떼고 다시 여는 주소. */
  unpinHref: string;
  isAdmin: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);
  const ready =
    title.trim().length > 0 &&
    [...title.trim()].length <= DISCUSSION_LIMIT.title &&
    postLength(body) > 0 &&
    postLength(body) <= DISCUSSION_LIMIT.post;

  return (
    <Form method="post" className="mb-6 space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">새 토론</h2>
      {revisionId !== null ? (
        <p className="text-sm text-muted-foreground">
          <Link
            to={revisionHref(revisionId)}
            className="text-primary tabular-nums hover:underline"
          >
            r{revisionId}
          </Link>{" "}
          판에 붙입니다.{" "}
          <Link to={unpinHref} className="underline">
            붙이지 않기
          </Link>
          <input
            type="hidden"
            name={DISCUSSION_FIELD.revisionId}
            value={revisionId}
          />
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="discussion-title">제목</Label>
        <Input
          id="discussion-title"
          name={DISCUSSION_FIELD.title}
          value={title}
          maxLength={DISCUSSION_LIMIT.title}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="discussion-body">첫 글</Label>
        <Textarea
          id="discussion-body"
          name={DISCUSSION_FIELD.body}
          value={body}
          rows={5}
          maxLength={DISCUSSION_LIMIT.post}
          required
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          글은 고칠 수 없습니다. 이름은 이 문서에서의 가명으로 남습니다. [[문서
          이름]]과 주소는 링크가 됩니다.
        </p>
      </div>
      {isAdmin ? (
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            name={DISCUSSION_FIELD.asAdmin}
            checked={asAdmin}
            onCheckedChange={setAsAdmin}
          />
          관리자로 쓰기
        </Label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !ready}>
          {pending ? <Spinner /> : null}
          토론 열기
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </Form>
  );
}
