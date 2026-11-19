import { describe, expect, it } from "vitest";

import { doc } from "./doc-builders";
import { mediaAlign, mediaSize } from "~/features/markup/model/media";
import { docToText, visibleTextLength } from "~/features/markup/model/text";
import {
  formatStart,
  parseYoutubeUrl,
  youtubeEmbedUrl,
  youtubeWatchUrl,
} from "~/features/markup/model/youtube";

const ID = "dQw4w9WgXcQ";
const IMAGE_ID = "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a";

describe("parseYoutubeUrl", () => {
  it.each([
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&list=PL123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ])("reads the video id from %s", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({ videoId: ID, start: 0 });
  });

  it.each([
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?t=90s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3723],
    [`https://www.youtube.com/embed/${ID}?start=45`, 45],
    [`https://www.youtube.com/watch?v=${ID}#t=30`, 30],
    [`https://youtu.be/${ID}?t=abc`, 0],
    [`https://youtu.be/${ID}?t=99999999999999999999`, 0],
    [`https://youtu.be/${ID}?t=999h`, 0],
  ])("reads the start time from %s", (url, start) => {
    expect(parseYoutubeUrl(url)?.start).toBe(start);
  });

  it.each([
    "",
    "그냥 글자",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC1234567890",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(parseYoutubeUrl(url)).toBeNull();
  });

  it("builds a no-cookie player address and a watch address", () => {
    expect(youtubeEmbedUrl({ videoId: ID, start: 0 })).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}`,
    );
    expect(youtubeEmbedUrl({ videoId: ID, start: 90 })).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?start=90`,
    );
    expect(
      parseYoutubeUrl(youtubeWatchUrl({ videoId: ID, start: 90 })),
    ).toEqual({ videoId: ID, start: 90 });
  });

  it("formats the start time", () => {
    expect(formatStart(5)).toBe("0:05");
    expect(formatStart(90)).toBe("1:30");
    expect(formatStart(3723)).toBe("1:02:03");
  });
});

describe("media size and alignment", () => {
  it("keeps images at their original size and left by default", () => {
    const image = { type: "image", attrs: { id: IMAGE_ID } };
    expect(mediaSize(image)).toBeNull();
    expect(mediaAlign(image)).toBe("left");
  });

  it("gives videos a default size", () => {
    expect(mediaSize({ type: "youtube", attrs: { videoId: ID } })).toBe(
      "large",
    );
  });

  it("ignores unknown values", () => {
    const image = {
      type: "image",
      attrs: { id: IMAGE_ID, size: "huge", align: "justify" },
    };
    expect(mediaSize(image)).toBeNull();
    expect(mediaAlign(image)).toBe("left");
  });
});

describe("docToText for media", () => {
  it("writes an image without layout as before", () => {
    expect(
      docToText(doc({ type: "image", attrs: { id: IMAGE_ID, alt: "지도" } })),
    ).toBe("[이미지 0b9f4c1e: 지도]");
  });

  it("shows layout changes in the text", () => {
    expect(
      docToText(
        doc({
          type: "image",
          attrs: { id: IMAGE_ID, alt: "지도", size: "small", align: "center" },
        }),
      ),
    ).toBe("[이미지 0b9f4c1e: 지도 (작게, 가운데 정렬)]");
  });

  it("writes a video with its start time and size", () => {
    expect(
      docToText(
        doc({
          type: "youtube",
          attrs: { videoId: ID, start: 90, size: "full", align: "left" },
        }),
      ),
    ).toBe(`[유튜브 ${ID} 90초부터 (본문 폭)]`);
  });

  it("leaves out the default video size", () => {
    expect(
      docToText(
        doc({ type: "youtube", attrs: { videoId: ID, size: "large" } }),
      ),
    ).toBe(`[유튜브 ${ID}]`);
  });

  it("writes the caption after the layout and counts it as visible text", () => {
    const body = doc({
      type: "image",
      attrs: { id: IMAGE_ID, alt: "지도", size: "small", caption: "본관 앞" },
    });
    expect(docToText(body)).toBe("[이미지 0b9f4c1e: 지도 (작게) — 본관 앞]");
    expect(visibleTextLength(body)).toBe(4);
  });
});
