import child_process from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";

const exec = util.promisify(child_process.exec);

const getCommitInfo = async () => {
  const log = await exec('git log -1 --format="%H %aI"');
  const parts = log.stdout.trim().split(" ");

  const status = await exec("git status --porcelain");

  return {
    commit: parts[0],
    clean: status.stdout.trim() === "",
    date: parts[1],
  };
};

const getVersion = async () => {
  const package_json = JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), "./package.json"))
  );
  const commitInfo = await getCommitInfo();

  const f = await fs.open(path.resolve(process.cwd(), "./src/version.ts"), "w");

  await f.write(`// GENERATED FILE -- DO NOT COMMIT

type PackageInfo = {
  name: string;
  version: string;
  commit: string;
  commitDate: Date;
  clean: boolean;
  buildDate: Date;
  repo: string;
  author: string;
}

`);

  await f.write(`export const PACKAGE_INFO: Readonly<PackageInfo> = {
  name: ${JSON.stringify(package_json.name)},
  version: ${JSON.stringify(package_json.version)},
  commit: ${JSON.stringify(commitInfo.commit)},
  commitDate: new Date(${JSON.stringify(commitInfo.date)}),
  clean: ${commitInfo.clean},
  buildDate: new Date(${JSON.stringify(new Date().toISOString())}),
  repo: ${JSON.stringify(package_json.repository.url)},
  author: ${JSON.stringify(package_json.author)},
};
`);

  await f.close();
};

getVersion().then(() => console.log("Generated version info"));
