# Publishing

EMTNotes is published to a public GitHub repo named `EMTNotes`. `.github/workflows/deploy.yml` builds it there and deploys it to GitHub Pages. The controller publishes it with the user, after Plan 3. The site stays unlisted: `index.html` has noindex and `robots.txt` disallows everything. The repo itself is public, so anyone can read everything in it. Run every command from the project folder.

## What a publish is

A publish is one snapshot commit of `main`'s current tree.
- `sources/` is untracked on `main`, so it is never in the snapshot.
- Its author and committer is the user's GitHub username, with GitHub's noreply address for it.
- Its parent is the last published commit, so GitHub shows one commit per publish.
- This repo's own history is never rewritten and never pushed.

`tools/publish_history.py` builds the snapshot in a temporary clone, `clean/`, never in this repo. It then copies just that commit into a fresh bare repo, `push.git/`, which holds nothing else: no other branch, no tag, no remote. `push.git/` is the only place to push from. Even `git push --all` or `--mirror` from it sends only the snapshot and the published commits it stands on. The tool never pushes by itself.

It scans what `push.git/` holds, and refuses on any of these:
- a personal value, read on this PC when the tool runs:
  - the names and emails of every author, committer and tagger this repo's branches, tags and reflogs reach;
  - `git config`'s user, author and committer names and emails, at every level;
  - the Windows username;
  - each `--extra-marker` you pass, and each line of each `--extra-marker-file`.

  Each email's local part (the part before the at sign) counts on its own, and so does each word of 4 letters or more in a name. A value is found inside other words, in any case, across spaces and line breaks, and in URL-encoded text, PNG text and UTF-16 text;
- an absolute profile path under any username: a Windows drive's Users folder, in either slash direction or the Git Bash form, or a macOS or Linux home folder;
- a path under `sources/`, or any path git ignores here, whether through `.gitignore`, `.git/info/exclude` or a global excludes file (such as `.claude/` or `.superpowers/`);
- a file over 5 MB, or a PDF, zip or Office file, whose inside the scan can't read;
- a signed commit.

It also checks that the snapshot's tree is the same as `main`'s, and that this repo's branches, files and `sources/` are untouched. It reads this repo without taking any lock. Its report shows a personal value only as `#n (kind, k chars)`, and a path only relative to `--work`, so the report is safe to paste.

## Before you start

- Ask the user for their GitHub username. This page writes it only as the placeholder `<github-user>`: never write the real one in a tracked file. If they want the `id+username` form of the noreply address, ask for their numeric id too: GitHub's email settings show it. Pass it as `--github-id`, and keep the same choice on every publish.
- If the GitHub username is the same as, contains, or is contained in a name, a name's word, an email, an email's local part or the Windows username on this PC, the tool refuses before it builds anything, naming only the kind of value and its length. Decide with the user what to do:
  - publish under another GitHub username, or change that local value; or
  - if the username holds the user's own name and they accept that it shows publicly, as the repo's owner and as the snapshot's author and committer, pass `--allow-github-user-overlap` on every run, `--scan-only` included. This is the user's explicit choice. Never add it for them, and never by default.

  With `--allow-github-user-overlap`:
  - the tool prints a masked notice instead of refusing: the kind and length of each value the username overlaps, and that the user accepted them;
  - exactly two strings may hold those values: the snapshot's author and committer name, which must be the username, and their email, which must be its noreply address;
  - everything else is scanned as before, and the username joins the markers. The tree, every commit message and every other field are refused if they hold the username, its noreply address, a value the username overlaps, any other marker (an email, a full name, the Windows username, an extra marker) or a profile path. No `--allow-file` waiver skips the username;
  - a value that overlaps only the noreply address (its domain or the `--github-id`), and not the username, is still refused before anything is built;
  - a published commit under the other form of the noreply address (with or without the id) is refused, which is why the `--github-id` choice stays the same.
- Ask the user for any other name the repo must never hold, such as their first name, and the former Owner value the spec's "Owner:" line held before the docs scrub. Pass them in a marker file, never on the command line, so no value sits in shell history or in an agent's transcript:
  - the user writes the file themselves, outside the project folder, one value a line (UTF-8; blank lines are skipped);
  - pass it as `--extra-marker-file <path>`, on every run, `--scan-only` included;
  - the tool refuses a marker file inside the project folder, reads it only while it runs, and never prints a value from it, or its path.

  `--extra-marker <value>` still works for a value that may sit in shell history, such as a made-up test value.
- The tool backs up `sources/` to `--backup` before it writes anything, and checks every copy against its original. Keep that backup somewhere lasting, not in Temp.
- `--work` and `--backup` must be new or empty folders outside the project folder, and apart: the tool refuses `--backup` inside `--work` (or the other way round), since `--work` is deleted after the push.
- If git on this PC is set to sign commits (`commit.gpgsign`), the tool stops before it writes anything. A signature names its key's owner, so a signed snapshot is never published, and the tool doesn't skip signing by itself. Whether to publish unsigned is the user's decision: if they choose to, turn `commit.gpgsign` off, then run the tool again.
- Never check out a commit from before `c1c3ef5` in this repo. Git deletes the `sources/` working copies when it moves off such a commit (the Plan 2 merge incident).

## The first publish

1. The user creates the empty public repo `EMTNotes` on github.com, with no README, licence or other starter files.
2. After Plan 3 is merged into `main`, run:
   ```bash
   py tools/publish_history.py --github-user <github-user> --work <dir> --backup <dir>
   ```
   Add `--allow-github-user-overlap` only if the user chose it (see "Before you start"), and `--extra-marker-file <path>` if they wrote one. Leave `--rev` at its default, `main`. The report must show:
   - with `--allow-github-user-overlap`, the masked notice that the user accepted the overlap;
   - one snapshot with no parent ("parent: none");
   - "tree equal to main^{tree}: yes";
   - "refs untouched: yes" and "working tree untouched: yes";
   - "problems: 0" and "result: OK".
3. Push the snapshot from `push.git/`:
   ```bash
   git -C <dir>/push.git push https://github.com/<github-user>/EMTNotes.git publish:main
   ```
   `<dir>` is the `--work` folder.
4. Delete the `--work` folder. `clean/` still stores this repo's older objects, even though nothing points at them any more.
5. In the repo, set Settings > Pages > Source to "GitHub Actions". In the Actions tab, open Deploy and press "Run workflow".

## Later publishes

1. Find the sha of the remote's `main`: `git ls-remote https://github.com/<github-user>/EMTNotes.git main`.
2. Run the tool as before, with the same flags (`--allow-github-user-overlap` and `--github-id` included, if the first publish had them) and new `--work` and `--backup` folders, and add `--parent <that sha> --remote https://github.com/<github-user>/EMTNotes.git`. It fetches the remote's `main`, and refuses unless it is that sha.
3. Push `publish:main` from the new `push.git/` as before. It is a fast-forward. Then delete that `--work` folder.

## When the scan refuses

The report lists each hit by path and line. A refused snapshot never becomes `push.git/`: the tool builds the push source under a temporary name, names it `push.git/` only after a clean scan, and removes it on a refusal or any error. It also takes the snapshot out of `clean/`, so nothing is left to push.
1. Remove each hit from the tracked file in a normal commit on `main`:
   - a profile path becomes a path inside the project (`sources/…`, `.superpowers/…`) or plain words ("the brief PDF in Downloads");
   - a name or an email address is taken out, and so is the GitHub username under `--allow-github-user-overlap`: write the placeholder `<github-user>` instead;
   - a file under `sources/` or another ignored folder is untracked with `git rm --cached`, which keeps it on disk;
   - a file over 5 MB, or a PDF, zip or Office file, is made smaller, converted or untracked.
2. Run `py tools/publish_history.py --scan-only` until it passes, with the same `--extra-marker-file` and `--extra-marker` values, and, if the user chose it, `--github-user <github-user> --allow-github-user-overlap`, so the scan looks for the username too. It scans `main`'s committed tree, so commit each fix first. Add `--rev <branch>` to scan another branch.
3. Publish again, with new `--work` and `--backup` folders.

A hit can be waived only if it is known to be safe, such as a made-up value in a test. Pass `--allow-file <tracked path>` for that file. Its content hits are then listed as waived rather than refused. Never waive a real value: remove it instead.
- A waiver never skips a whole value: a full email, a full name, the Windows username or an extra marker is refused in any file. Only a part of one (a name's word, an email's local part) or a profile path can be waived.
- A waiver that waives nothing gets a warning, so a mistyped path or a fixed file doesn't keep a waiver alive unnoticed.

Never push a snapshot the tool refused.
