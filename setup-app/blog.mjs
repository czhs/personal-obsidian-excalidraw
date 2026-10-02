/** Drafts Jekyll blog posts in a chosen site folder and opens them in an editor. */
import { readFile, writeFile, mkdir, stat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const SUBL = "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl";

const pad = (value) => String(value).padStart(2, "0");

/** Local timestamp in Jekyll's format, e.g. 2026-10-02 14:05:00-0400. */
export function jekyllDate(now = new Date()) {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:00${sign}${hours}${minutes}`
  );
}

/**
 * Blank front matter with commented examples; title stays on line 3 so the
 * editor cursor lands after "title: ". Two spaces before each "#" keep the
 * comment separate from whatever is typed there.
 */
export function frontMatter(date) {
  return [
    "---",
    "layout: post",
    "title:  # e.g. Infrastructure network effects",
    `date: ${date} # set when created; posts are sorted by this`,
    "description:  # one line shown under the title, e.g. a blog-in-progress examining the network effects of infrastructure",
    "tags:  # space-separated, e.g. infrastructure biodefense",
    "categories:  # optional, e.g. strategy",
    "related_posts: false",
    "published: false # draft — flip to true to publish; rename this file to YYYY-MM-DD-your-title.md first (it sets the URL)",
    "---",
    "",
    "",
  ].join("\n");
}

export class BlogDrafts {
  constructor(userData, { open } = {}) {
    this.settingsPath = path.join(userData, "blog.json");
    this.siteDirectory = null;
    if (open) this.open = open;
  }

  async init() {
    try {
      const saved = JSON.parse(await readFile(this.settingsPath, "utf8"));
      if (typeof saved.siteDirectory === "string")
        this.siteDirectory = saved.siteDirectory;
    } catch {
      this.siteDirectory = null;
    }
  }

  status() {
    return { siteDirectory: this.siteDirectory };
  }

  async setSite(selected) {
    const directory = await realpath(selected);
    const hasConfig = await stat(path.join(directory, "_config.yml")).then(
      () => true,
      () => false,
    );
    if (!hasConfig)
      throw new Error(
        "This folder is not a Jekyll site. Choose the folder that contains _config.yml.",
      );
    this.siteDirectory = directory;
    await writeFile(
      this.settingsPath,
      JSON.stringify({ siteDirectory: directory }, null, 2),
      { mode: 0o600 },
    );
    return this.status();
  }

  /** Creates _posts/YYYY-MM-DD-untitled[-n].md immediately and opens it. */
  async create() {
    if (!this.siteDirectory) throw new Error("Choose your website folder first.");
    const now = new Date();
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const posts = path.join(this.siteDirectory, "_posts");
    await mkdir(posts, { recursive: true });
    const content = frontMatter(jekyllDate(now));
    for (let n = 1; n < 100; n++) {
      const file = path.join(
        posts,
        `${day}-untitled${n === 1 ? "" : `-${n}`}.md`,
      );
      try {
        // "wx" never overwrites an existing post.
        await writeFile(file, content, { flag: "wx" });
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
      return { file, editor: await this.open(file) };
    }
    throw new Error("Too many untitled drafts today. Rename some first.");
  }

  /** Sublime Text when installed (cursor after "title: "), else the default text editor. */
  async open(file) {
    try {
      await run(SUBL, [`${file}:3:8`]);
      return "Sublime Text";
    } catch {}
    try {
      await run("/usr/bin/open", ["-a", "Sublime Text", file]);
      return "Sublime Text";
    } catch {}
    await run("/usr/bin/open", ["-t", file]);
    return "your text editor";
  }
}
