/**
 * uuid v4. `crypto.randomUUID`는 HTTPS(또는 localhost)에서만 있어서, 같은 네트워크의 휴대폰으로
 * 개발 서버를 열 때는 `getRandomValues`로 직접 만든다. KMLA Online에서 가져왔다.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // 버전(4)과 변형(RFC 4122) 비트.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}
