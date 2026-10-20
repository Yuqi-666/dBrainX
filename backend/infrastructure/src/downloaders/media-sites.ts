// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fixed catalog of media sites the import dialogs show.
 *
 * yt-dlp supports far more sites than these eight, and a pasted address of any
 * other site still imports; it just has no capsule in the dialog and no saved
 * login UI. This file is the one place that answers three questions:
 *
 * - which sites exist and what each one is called;
 * - which hosts belong to a site, so a pasted address can highlight a capsule
 *   and a `cookies.txt` export can be split per site;
 * - which public page is used to verify a saved login.
 *
 * Hosts are matched as suffixes on a label boundary: `bilibili.com` matches
 * `www.bilibili.com` but not `notbilibili.com`. The list is static
 * configuration, not state, which is why this is a catalog and not a
 * repository.
 *
 * The probe addresses are public pages that need no login. A site can move or
 * remove a page; when that happens only the matching `probeUrl` needs a new
 * public address, and nothing else in the import flow changes.
 */

import type { MediaKind } from "@workspace/interfaces";
import type { IMediaSiteCatalog, MediaSiteDefinition } from "@workspace/domain";

/** The eight sites, in the order the dialogs show their capsules. */
export const MEDIA_SITES: MediaSiteDefinition[] = [
  {
    key: "bilibili",
    name: "B 站",
    kinds: ["video"],
    hosts: ["bilibili.com", "b23.tv"],
    loginHint: "登录后才能下载高清和大会员视频。",
    probeUrl: "https://www.bilibili.com/video/BV1GJ411x7h7",
  },
  {
    key: "douyin",
    name: "抖音",
    kinds: ["video"],
    hosts: ["douyin.com", "iesdouyin.com"],
    loginHint: "多数视频需要登录后才能下载。",
    probeUrl: "https://www.douyin.com/video/6961737553342991651",
  },
  {
    key: "xiaohongshu",
    name: "小红书",
    kinds: ["video"],
    hosts: ["xiaohongshu.com", "xhslink.com"],
    loginHint: "多数笔记视频需要登录后才能下载。",
    probeUrl: "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9",
  },
  {
    key: "youtube",
    name: "YouTube",
    kinds: ["video"],
    hosts: ["youtube.com", "youtu.be"],
    loginHint: "高清、会员和年龄限制视频需要登录。",
    probeUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  },
  {
    key: "tiktok",
    name: "TikTok",
    kinds: ["video"],
    hosts: ["tiktok.com"],
    loginHint: "多数视频需要登录后才能下载。",
    probeUrl: "https://www.tiktok.com/@tiktok/video/7106594312292453675",
  },
  {
    key: "netease",
    name: "网易云音乐",
    kinds: ["audio"],
    hosts: ["music.163.com", "163cn.tv"],
    loginHint: "登录后可解锁较高、极高和无损音质。",
    probeUrl: "https://music.163.com/song?id=1901371647",
  },
  {
    key: "qqmusic",
    name: "QQ 音乐",
    kinds: ["audio"],
    hosts: ["y.qq.com", "i.y.qq.com", "c6.y.qq.com"],
    loginHint: "QQ 音乐需要登录后才能解析和下载。",
    probeUrl: "https://y.qq.com/n/ryqq/songDetail/003OUlho2HcRHC",
  },
  {
    key: "ximalaya",
    name: "喜马拉雅",
    kinds: ["audio"],
    hosts: ["ximalaya.com", "xima.tv"],
    loginHint: "部分节目需要登录后才能下载。",
    probeUrl: "https://www.ximalaya.com/sound/16826748",
  },
];

/**
 * Reads the site list and matches addresses against it.
 *
 * The constructor takes an explicit list so a test or a future edition of the
 * product can use a different one, but production always passes the static
 * {@link MEDIA_SITES} list.
 */
export class StaticMediaSiteCatalog implements IMediaSiteCatalog {
  private readonly sites: readonly MediaSiteDefinition[];

  constructor(sites: readonly MediaSiteDefinition[] = MEDIA_SITES) {
    this.sites = sites;
  }

  list(kind?: MediaKind): MediaSiteDefinition[] {
    return kind === undefined
      ? [...this.sites]
      : this.sites.filter((site) => site.kinds.includes(kind));
  }

  match(rawUrl: string): MediaSiteDefinition | null {
    let host: string;
    try {
      const url = new URL(rawUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      host = url.hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return null;
    }

    for (const site of this.sites) {
      if (site.hosts.some((suffix) => hostMatches(host, suffix))) {
        return site;
      }
    }
    return null;
  }

  find(key: string): MediaSiteDefinition | null {
    return this.sites.find((site) => site.key === key) ?? null;
  }
}

/**
 * True when `host` is the listed suffix or a subdomain of it.
 *
 * The dot before the suffix is load-bearing: without it a look-alike host such
 * as `notbilibili.com` would match `bilibili.com`.
 */
function hostMatches(host: string, suffix: string): boolean {
  const normalized = suffix.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}
