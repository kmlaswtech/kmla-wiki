import { redirect } from "react-router";

import type { Route } from "./+types/random";
import { withVerifiedMember } from "~/features/auth";
import { pageHref } from "~/features/markup";
import { getRandomTitle } from "~/features/pages";

/** 아무 문서로 보낸다. 문서가 하나도 없으면 대문으로. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const title = await withVerifiedMember(request, getRandomTitle);
  throw redirect(title ? pageHref(title) : "/");
}

export default function RandomRoute() {
  return null;
}
