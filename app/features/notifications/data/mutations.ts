import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/** 문서를 즐겨찾기에 더하거나 뺀다. 이미 그 상태면 아무것도 하지 않는다. */
export async function setPageWatched(
  pageId: number,
  watched: boolean,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("set_page_watched", {
      p_page_id: pageId,
      p_watched: watched,
    }),
  );
}
