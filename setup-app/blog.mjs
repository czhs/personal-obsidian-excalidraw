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

export function slugify(title) {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** YAML double-quoted scalars are a superset of JSON strings. */
const quote = (value) => JSON.stringify(value);

export function frontMatter({ title, description, tags, date }) {
  const tagList = tags
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(" ");
  return [
    "---",
    "layout: post",
    `title: ${quote(title)}`,
    `date: ${date}`,
    `description: ${quote(description)}`,
    `tags: ${tagList}`,
    "categories:",
    "related_posts: false",
    "published: false # draft — flip to true to publish",
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

  async create({ title, description = "", tags = "" } = {}) {
    if (!this.siteDirectory) throw new Error("Choose your website folder first.");
    if (typeof title !== "string" || !title.trim())
      throw new Error("Give your post a title.");
    if (typeof description !== "string" || typeof tags !== "string")
      throw new Error("Invalid post details.");
    title = title.trim();
    const slug = slugify(title);
    if (!slug)
      throw new Error("Use at least one letter or number in the title.");
    const now = new Date();
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const posts = path.join(this.siteDirectory, "_posts");
    await mkdir(posts, { recursive: true });
    const file = path.join(posts, `${day}-${slug}.md`);
    const content = frontMatter({
      title,
      description: description.trim(),
      tags,
      date: jekyllDate(now),
    });
    // "wx" never overwrites an existing post.
    await writeFile(file, content, { flag: "wx" }).catch((error) => {
      if (error.code === "EEXIST")
        throw new Error(
          `A post named ${path.basename(file)} already exists. Choose a different title.`,
        );
      throw error;
    });
    const editor = await this.open(file, content.split("\n").length - 1);
    return { file, editor };
  }

  /** Sublime Text when installed (cursor on the first body line), else the default text editor. */
  async open(file, line) {
    try {
      await run(SUBL, [`${file}:${line}`]);
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
