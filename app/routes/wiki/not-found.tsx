import { data } from "react-router";

/** 정해 둔 주소가 아니면 404. root의 ErrorBoundary가 그린다. */
export function clientLoader() {
  throw data(null, { status: 404 });
}

export default function NotFound() {
  return null;
}
