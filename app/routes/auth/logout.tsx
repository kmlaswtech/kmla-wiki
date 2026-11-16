import { redirect } from "react-router";

import { signOut } from "~/features/auth";
import { clearAllDrafts } from "~/features/editor";
import { clearImageCache } from "~/features/images";

/** 화면 없이 로그아웃만 한다. 이 브라우저에 남긴 임시 저장과 받아 둔 이미지도 함께 지운다. */
export async function clientLoader() {
  await signOut();
  clearAllDrafts();
  await clearImageCache();
  throw redirect("/login");
}

export default function Logout() {
  return null;
}
