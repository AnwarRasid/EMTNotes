"""Build the next commit of the public EMTNotes repo: one snapshot of a branch's tree, never this repo's history.

It works only in two temporary folders under --work:
- clean/: a --no-local --single-branch clone of --rev (default main). There it builds one commit from --rev's tree,
  authored and committed as --github-user with GitHub's noreply address, on the last published commit (--parent,
  checked against --remote's main) or on nothing the first time.
- push.git/: a fresh bare repo holding only that commit, as refs/heads/publish, with the published parents it
  stands on. It is what you push from. Nothing else is in it, so even push --all or --mirror sends only that.
  It is built under a temporary name and named push.git only after a clean scan; on a refusal or any failure the
  tool removes it, so no unscanned snapshot is ever left ready to push. Before it is built, clean/ is cut down the
  same way: no other ref, no tag, no remote.
The --github-user is checked against every marker first, both ways round; on any overlap nothing is built, unless the
user chose --allow-github-user-overlap (a username that holds their own name). Then the tool prints a masked notice
instead, and exactly two strings may hold the values the username overlaps: the snapshot's author and committer name,
equal to --github-user, and their email, equal to its noreply address. The username itself joins the markers,
unwaivable, so the tree, every commit message and every other field are still refused on it and on every other
marker; a value that overlaps only the noreply address, not the username, is still refused before anything is built.
Before anything is written it copies sources/ outside the repo, hash-verified. Then it scans what push.git holds,
and refuses on any hit:
- a value read at runtime on this machine and never written down: every author, committer and tagger name and email
  that this repo's refs and reflogs reach; git config's user, author and committer names and emails, at every scope;
  the OS user names; each --extra-marker; and each line of each --extra-marker-file, a file outside the repo read at
  runtime, so a value never sits in shell history. Each email's local part, and each name's words of 4 letters or more,
  count on their own. They match as substrings, ignoring case, across spaces and line breaks, and in URL-decoded
  text, PNG text chunks (inflated) and UTF-16 text;
- an absolute profile path, whatever the user: a Windows drive's Users folder (either slash, or the Git Bash form),
  or a macOS or Linux home folder;
- a sources/ path; a path git ignores here (.gitignore, info/exclude or core.excludesFile); a blob over 5 MB; a
  compressed container (pdf, zip, docx and the like) whose inside the scan can't read;
- a signed commit, or a push source holding anything but the snapshot and its parents.
A hit in a file named by --allow-file is waived and listed, never dropped silently, unless it is a whole value (a full
email, a full name, an OS user name, an extra marker, or the GitHub username under --allow-github-user-overlap), which
no waiver skips; a waiver that waives nothing is warned about. --backup and --work must be apart, neither inside the
other. It never signs and never skips signing: when git is set to sign (commit.gpgsign), it stops for the user to
decide. It also checks that the
snapshot's tree equals --rev's, and that this repo's refs, working tree and sources/ are untouched; it reads this repo
without taking any lock. Every line it prints goes through shown(): a marker appears only as '#n (kind, k chars)',
and paths only relative to --work. It never pushes: docs/publishing.md says who pushes, and how.

  py tools/publish_history.py --github-user <github-user> [--github-id <id>] [--allow-github-user-overlap]
      [--parent <sha> --remote <url>] --work <dir outside the repo> --backup <dir outside the repo> [--repo <path>]
      [--rev <ref>] [--extra-marker <value>]... [--extra-marker-file <file outside the repo>]...
      [--allow-file <tracked path>]...
  py tools/publish_history.py --scan-only [--github-user <github-user> [--allow-github-user-overlap]] [--repo <path>]
      [--rev <ref>] [--extra-marker <value>]... [--extra-marker-file <file outside the repo>]...
      [--allow-file <tracked path>]...
"""
from __future__ import annotations

import argparse
import bisect
import fnmatch
import hashlib
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zlib
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

MAX_BLOB_BYTES = 5 * 1024 * 1024
SNAPSHOT_BRANCH = 'publish'
SNAPSHOT_MESSAGE = 'Publish EMTNotes'          # the whole message: no personal value, no local sha
PUSH_SOURCE = 'push.git'
UNSCANNED_PREFIX = 'push-unscanned-'              # the push source's name inside --work until its scan is clean
NOREPLY_DOMAIN = 'users.noreply.github.com'
MIN_MARKER = 4                                    # shorter values are skipped, and counted
_GITHUB_USER = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?')
_STATUS_SPLIT = '\n== working tree ==\n'
SIGNING_REFUSAL = ('git here is set to sign commits (commit.gpgsign). A signature names its key\'s owner, so a '
                   'signed snapshot is never published, and this tool does not skip signing for you. Whether to '
                   'publish unsigned is your decision: if you choose to, turn commit.gpgsign off, then run it again.')
_SIGNING_ERROR = re.compile(r'\bgpg\b|\bsign(?:ing|ed|ature)?\b', re.I)     # gpg, ssh and x509 signing errors
_CONTAINERS = {'.pdf', '.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub', '.jar', '.gz', '.tgz',
               '.7z', '.rar'}
_WS = re.compile(r'\s+')
_WORD = re.compile(r'[^\W\d_]{4,}')               # a name's words of 4 letters or more
_PCT_RUN = re.compile(r'(?:%[0-9A-Fa-f]{2})+')
_USERS, _HOME = 'Users', 'home'                   # kept apart so this file's own text holds no profile path
_PROFILE = re.compile(
    rf'(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]+{_USERS}[\\/]+'      # a Windows drive's Users folder, either slash
    rf'|(?<![\w.-])/[A-Za-z]/{_USERS}/'                        # the same in Git Bash form
    rf'|(?<![\w.:-])/{_USERS}/'                                # macOS
    rf'|(?<![\w.:-])/{_HOME}/)'                                # Linux
    r'(?P<who>[^\s\\/\'"`|*?:;,)\]]+)', re.I)
_PNG = b'\x89PNG\r\n\x1a\n'


class Refused(ValueError):
    """A check failed, or an argument would make the tool write where it must not."""


class GitError(RuntimeError):
    """A git command failed. Its message holds git's stderr, so main() prints it only through shown()."""


@dataclass(frozen=True, repr=False)
class Marker:
    kind: str     # 'email' | 'name' | 'user' | 'extra' | 'github' (the username, under --allow-github-user-overlap)
    value: str    # never printed, logged or written to a file
    origin: str = field(default='', compare=False)    # what it is, for messages: 'name word', 'OS username', …

    def __repr__(self) -> str:                  # a failed assert or a traceback shows no value either
        return f'Marker({self.kind!r}, <{len(self.value)} chars>)'


class MarkerList(list):
    """personal_markers()'s result: the markers; how many values of 3 characters or fewer it skipped; and the values
    equal to --github-user, which main() refuses on rather than drop (or, under --allow-github-user-overlap, scans
    for as the username's own marker)."""
    short_skipped: int = 0
    allowed_matches: list = []


@dataclass
class Report:
    snapshot: str | None
    parent: str | None
    tree_equal: bool
    refs_untouched: bool
    worktree_untouched: bool
    problems: list[str] = field(default_factory=list)   # masked: a marker shows only as '#n (kind, k chars)'

    @property
    def ok(self) -> bool:
        return (bool(self.snapshot) and self.tree_equal and self.refs_untouched and self.worktree_untouched
                and not self.problems)


# --- git -----------------------------------------------------------------------------------------------------------

def _env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The caller's environment minus every GIT_* variable (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the like
    would point git at another repo), plus: no password prompt, no optional locks, and the tool's own extras."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
    env.update(GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0')
    env.update(extra or {})
    return env


def _run(repo: Path, *args: str, env: dict[str, str] | None = None,
         stdin: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, env=_env(env), input=stdin)


def _git(repo: Path, *args: str, env: dict[str, str] | None = None, stdin: bytes | None = None) -> bytes:
    r = _run(repo, *args, env=env, stdin=stdin)
    if r.returncode != 0:
        err = r.stderr.decode('utf-8', 'replace').strip()
        raise GitError(f'git {args[0]} failed (exit {r.returncode}): {err}')
    return r.stdout


def _gits(repo: Path, *args: str, env: dict[str, str] | None = None) -> str:
    return _git(repo, *args, env=env).decode('utf-8', 'replace').strip()


def _objects(git_dir: Path, shas: list[str]):
    """Yield (sha, raw bytes) for each sha, through one git cat-file --batch."""
    if not shas:
        return
    out = _git(git_dir, 'cat-file', '--batch', stdin=''.join(f'{s}\n' for s in shas).encode())
    pos = 0
    for sha in shas:
        nl = out.index(b'\n', pos)
        header = out[pos:nl].split()
        if len(header) != 3:
            raise GitError(f'git cat-file could not read object {sha[:12]}')
        size = int(header[2])
        start = nl + 1
        yield sha, out[start:start + size]
        pos = start + size + 1


# --- identity ------------------------------------------------------------------------------------------------------

def noreply_email(user: str, user_id: str | None = None) -> str:
    if not isinstance(user, str) or not _GITHUB_USER.fullmatch(user):
        raise ValueError('--github-user must be a GitHub username: 1 to 39 letters, digits or hyphens, '
                         'with no hyphen at either end')
    if user_id is None:
        return f'{user}@{NOREPLY_DOMAIN}'
    if not re.fullmatch(r'[0-9]+', str(user_id)):
        raise ValueError('--github-id must be the numeric id that GitHub shows in its email settings')
    return f'{user_id}+{user}@{NOREPLY_DOMAIN}'


def os_username() -> str:
    try:
        return os.getlogin()
    except OSError:
        return Path.home().name


def os_user_names() -> set[str]:
    """Every name this machine knows the user by: the login, the home folder's name, USERNAME and USER."""
    names = {os_username()}
    try:
        names.add(Path.home().name)
    except (RuntimeError, OSError):
        pass
    names.update(os.environ.get(var, '') for var in ('USERNAME', 'USER'))
    return {n for n in names if n and n.strip()}


def _norm(value: str) -> str:
    return _WS.sub(' ', value).strip()


def _key(value: str) -> str:
    return _norm(value).casefold()


def _is_noreply(email: str) -> bool:
    e = email.casefold()
    return e.endswith('@' + NOREPLY_DOMAIN) or e.split('@', 1)[0] == 'noreply'


def _identities(repo: Path) -> list[tuple[str, str]]:
    """(kind, value) for every identity this repo and this machine hold."""
    found: list[tuple[str, str]] = []
    log = _git(repo, 'log', '--all', '--reflog', '--format=%an%x00%ae%x00%cn%x00%ce').decode('utf-8', 'replace')
    for line in log.splitlines():
        parts = line.split('\0')
        if len(parts) == 4:
            found += [('name', parts[0]), ('email', parts[1]), ('name', parts[2]), ('email', parts[3])]
    tags = _git(repo, 'for-each-ref', '--format=%(taggername)%00%(taggeremail)', 'refs/tags')
    for line in tags.decode('utf-8', 'replace').splitlines():
        name, _, email = line.partition('\0')
        found += [('name', name), ('email', email.strip().strip('<>'))]
    for key, kind in (('user.name', 'name'), ('user.email', 'email'), ('author.name', 'name'),
                      ('author.email', 'email'), ('committer.name', 'name'), ('committer.email', 'email')):
        r = _run(repo, 'config', '--get-all', key)
        if r.returncode == 0:
            found += [(kind, v) for v in r.stdout.decode('utf-8', 'replace').splitlines()]
    found += [('user', n) for n in sorted(os_user_names())]
    return found


def personal_markers(repo: Path, allowed: set[str], extra: list[str] | tuple[str, ...] = ()) -> list[Marker]:
    """Every identity _identities() finds, each email's local part, each name's words of 4 letters or more, and the
    extra values. Noreply addresses are skipped. Values of 3 characters or fewer are skipped and counted in
    short_skipped. Values equal to an `allowed` one (the --github-user) go to allowed_matches, never dropped."""
    allow = {_key(a) for a in allowed if a}
    candidates: list[tuple[str, str, str]] = []
    for kind, raw in _identities(repo):
        value = _norm(raw)
        if not value:
            continue
        if kind == 'email':
            if _is_noreply(value):
                continue
            candidates.append(('email', value, 'email'))
            local = value.split('@', 1)[0]
            if local and local != value:
                candidates.append(('email', local, 'email local part'))
        elif kind == 'name':
            candidates.append(('name', value, 'name'))
            if _key(value) not in allow:            # the GitHub user's own name is no source of words
                candidates += [('name', w, 'name word') for w in _WORD.findall(value)]
        else:
            candidates.append((kind, value, 'OS username'))
    candidates += [('extra', _norm(e), 'extra marker') for e in extra if _norm(e)]

    seen: set[str] = set()
    short: set[str] = set()
    picked: list[Marker] = []
    matches: list[Marker] = []
    for kind, value, origin in candidates:
        key = _key(value)
        if key in seen:
            continue
        if key in allow:
            seen.add(key)
            matches.append(Marker(kind, value, origin))
        elif len(value) < MIN_MARKER:
            short.add(key)
        else:
            seen.add(key)
            picked.append(Marker(kind, value, origin))
    rank = {'email': 0, 'name': 1, 'user': 2, 'extra': 3}
    result = MarkerList(sorted(picked, key=lambda m: (rank.get(m.kind, 4), _key(m.value))))
    result.short_skipped = len(short)
    result.allowed_matches = matches
    return result


def read_marker_files(paths: list[str] | tuple[str, ...], repo: Path) -> list[str]:
    """The extra markers in each --extra-marker-file: one a line, read at runtime, with blank lines skipped and the
    spaces around each value dropped (UTF-8, a byte-order mark allowed). Each file must be outside the repo, so it is
    never committed, and the values never sit in shell history. Neither a path nor a value is ever echoed: a file
    that can't be read is refused in fixed words."""
    values: list[str] = []
    for raw in paths:
        p = Path(raw).resolve()
        if _inside(p, repo):
            raise Refused('--extra-marker-file must be outside the repo (the file is not read and its path is not '
                          'echoed): keep it where it can never be committed')
        try:
            text = p.read_text(encoding='utf-8-sig')
        except (OSError, UnicodeError):
            raise Refused('--extra-marker-file could not be read as UTF-8 text (its path and contents are not '
                          'echoed)') from None
        values += [v for v in (line.strip() for line in text.splitlines()) if v]
    return values


def mask(m: Marker, n: int) -> str:
    return f'#{n} ({m.kind}, {len(m.value)} chars)'


def _source(m: Marker) -> str:
    return r'\s+'.join(re.escape(w) for w in _norm(m.value).split(' '))


@lru_cache(maxsize=None)
def _marker_rx(m: Marker) -> re.Pattern:
    """A marker as a substring, ignoring case, with any run of whitespace (line breaks too) between its words."""
    return re.compile(_source(m), re.I)


def overlaps_username(user: str, m: Marker) -> bool:
    """Does m overlap the username itself, either way round, ignoring case: m found inside it, or it inside m?"""
    return bool(_marker_rx(m).search(user)) or _key(user) in _key(m.value)


def github_user_overlaps(user: str, email: str, markers: list[Marker]) -> list[Marker]:
    """The markers that overlap --github-user, either way round, ignoring case: one found inside the username or its
    noreply address, or the username found inside one. Publishing under such a name would put the value in the
    public repo, so main() refuses on any of them before anything is built, unless the user chose
    --allow-github-user-overlap and each one overlaps the username itself."""
    return [m for m in markers if overlaps_username(user, m) or _marker_rx(m).search(email)]


def github_user_marker(user: str) -> Marker:
    """Under --allow-github-user-overlap the username holds a personal value, so it is a marker itself: unwaivable,
    and allowed only as the snapshot's author and committer name (scan_commits' identity)."""
    return Marker('github', _norm(user), 'GitHub username')


def shown(text: str, markers: list[Marker]) -> str:
    """text with every marker, in any case and spacing, replaced by its mask. All printed text goes through it."""
    if not markers:
        return text
    order = sorted(range(len(markers)), key=lambda i: -len(markers[i].value))
    pattern = re.compile('|'.join(f'(?P<m{i}>{_source(markers[i])})' for i in order), re.I)
    return pattern.sub(lambda mo: mask(markers[int(mo.lastgroup[1:])], int(mo.lastgroup[1:]) + 1), text)


# --- finding markers and profile paths in text ---------------------------------------------------------------------

def _url_view(text: str) -> tuple[str, list[int], list[int]] | None:
    """text with each %XX run decoded as UTF-8 and '+' read as a space, and the anchors that map a position in it
    back to text. None when decoding would change nothing."""
    if '%' not in text and '+' not in text:
        return None
    parts, d_anchor, o_anchor, pos, dpos = [], [0], [0], 0, 0
    for mo in _PCT_RUN.finditer(text):
        start, end = mo.span()
        parts.append(text[pos:start])
        dpos += start - pos
        decoded = bytes.fromhex(mo.group().replace('%', '')).decode('utf-8', 'replace')
        parts.append(decoded)
        dpos += len(decoded)
        d_anchor.append(dpos)
        o_anchor.append(end)
        pos = end
    parts.append(text[pos:])
    view = ''.join(parts).replace('+', ' ')
    return None if view == text else (view, d_anchor, o_anchor)


def _hits_in_text(text: str, markers: list[Marker]) -> list[tuple[int, str]]:
    """(position in text, what) for every marker and every absolute profile path, found in text as it is and in its
    URL-decoded view."""
    found: list[tuple[int, str]] = []
    views: list[tuple[str, list[int] | None, list[int] | None]] = [(text, None, None)]
    decoded = _url_view(text)
    if decoded:
        views.append(decoded)
    for view, d_anchor, o_anchor in views:
        def back(p: int, d=d_anchor, o=o_anchor) -> int:
            if d is None:
                return p
            i = bisect.bisect_right(d, p) - 1
            return o[i] + (p - d[i])
        for i, m in enumerate(markers):
            found += [(back(mo.start()), f'marker {mask(m, i + 1)}') for mo in _marker_rx(m).finditer(view)]
        found += [(back(mo.start()), f'an absolute profile path (its user folder is {len(mo.group("who"))} chars)')
                  for mo in _PROFILE.finditer(view)]
    return found


def _by_line(text: str, hits: list[tuple[int, str]], where: str, tail: str = '') -> list[str]:
    seen: dict[str, None] = {}
    for pos, what in sorted(hits, key=lambda h: h[0]):
        seen.setdefault(f'{where}:{text.count(chr(10), 0, pos) + 1}: {what}{tail}', None)
    return list(seen)


def _inflate(data: bytes) -> bytes:
    d = zlib.decompressobj()
    out = d.decompress(data, MAX_BLOB_BYTES)
    if d.unconsumed_tail:
        raise ValueError('inflates past the size limit')
    return out


def _png_texts(data: bytes) -> list[tuple[str, str | None]]:
    """(chunk type, text) for every tEXt, zTXt and iTXt chunk, inflated where compressed; text None when the chunk
    can't be read."""
    out: list[tuple[str, str | None]] = []
    pos = len(_PNG)
    while pos + 8 <= len(data):
        length = int.from_bytes(data[pos:pos + 4], 'big')
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        name = kind.decode('latin-1')
        try:
            if kind == b'tEXt':
                key, _, text = body.partition(b'\0')
                out.append((name, (key + b' ' + text).decode('latin-1')))
            elif kind == b'zTXt':
                key, _, rest = body.partition(b'\0')
                out.append((name, key.decode('latin-1') + ' ' + _inflate(rest[1:]).decode('latin-1')))
            elif kind == b'iTXt':
                key, _, rest = body.partition(b'\0')
                compressed, rest = rest[0], rest[2:]
                lang, _, rest = rest.partition(b'\0')
                translated, _, text = rest.partition(b'\0')
                text = _inflate(text) if compressed else text
                out.append((name, b' '.join((key, lang, translated, text)).decode('utf-8', 'replace')))
        except (zlib.error, IndexError, ValueError):
            out.append((name, None))
        if kind == b'IEND':
            break
    return out


def _binary_views(data: bytes) -> list[str]:
    """A binary blob read as UTF-8, and as UTF-16 in both byte orders at both alignments."""
    views = [data.decode('utf-8', 'replace')]
    for codec in ('utf-16-le', 'utf-16-be'):
        for offset in (0, 1):
            chunk = data[offset:]
            views.append(chunk[:len(chunk) - len(chunk) % 2].decode(codec, 'replace'))
    return views


def _blob_hits(path: str, data: bytes, markers: list[Marker]) -> list[str]:
    where = shown(path, markers)
    if b'\0' not in data[:8192]:
        text = data.decode('utf-8', 'replace')
        return _by_line(text, _hits_in_text(text, markers), where)
    hits: dict[str, None] = {}
    for view in _binary_views(data):
        firsts: dict[str, int] = {}
        for pos, what in _hits_in_text(view, markers):
            firsts.setdefault(what, pos)
        for what, pos in firsts.items():
            if not any(h.endswith(f': {what} (binary)') for h in hits):
                hits.setdefault(f'{where}:{view.count(chr(10), 0, pos) + 1}: {what} (binary)', None)
    if data.startswith(_PNG):
        for chunk, text in _png_texts(data):
            if text is None:
                hits.setdefault(f"{where}: a PNG {chunk} chunk the scan can't read", None)
                continue
            for _pos, what in _hits_in_text(text, markers):
                hits.setdefault(f'{where}: {what} in a PNG {chunk} chunk', None)
    return list(hits)


# --- this repo's state, and the sources/ backup --------------------------------------------------------------------

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _sources_digest(repo: Path) -> str:
    src = repo / 'sources'
    if not src.is_dir():
        return 'sources/: none\n'
    return ''.join(f'sources/{p.relative_to(src).as_posix()} {_sha256(p)}\n'
                   for p in sorted(src.rglob('*')) if p.is_file())


def state_of(repo: Path) -> str:
    """for-each-ref refname and objectname and HEAD's target; then git status --porcelain=v1 --ignored, without
    optional locks (so it never rewrites the index), and the sha256 of every file under sources/."""
    refs = _git(repo, 'for-each-ref', '--format=%(refname) %(objectname)').decode('utf-8', 'replace')
    sym = _run(repo, 'symbolic-ref', '-q', 'HEAD').stdout.decode('utf-8', 'replace').strip()
    head = _run(repo, 'rev-parse', '-q', '--verify', 'HEAD').stdout.decode('utf-8', 'replace').strip()
    status = _git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '--ignored').decode('utf-8', 'replace')
    return f'{refs}HEAD {sym or "(detached)"} {head}{_STATUS_SPLIT}{status}{_sources_digest(repo)}'


def _halves(state: str) -> tuple[str, str]:
    refs, _, worktree = state.partition(_STATUS_SPLIT)
    return refs, worktree


def _inside(path: Path, repo: Path) -> bool:
    p, r = path.resolve(), repo.resolve()
    return p == r or r in p.parents


def backup_sources(repo: Path, dest: Path) -> dict[str, str]:
    """Copy repo/sources to dest and re-hash every copy. Returns {path relative to sources/: sha256}; {} when the
    repo has no sources/ (a fresh clone or a worktree), which copies nothing."""
    if _inside(dest, repo):
        raise Refused('--backup must be outside the repo')
    dest = dest.resolve()
    if dest.exists() and (not dest.is_dir() or any(dest.iterdir())):
        raise Refused('--backup must be a new or empty folder')
    src = repo.resolve() / 'sources'
    if not src.is_dir():
        return {}
    originals = {p.relative_to(src).as_posix(): _sha256(p) for p in sorted(src.rglob('*')) if p.is_file()}
    shutil.copytree(src, dest, dirs_exist_ok=True)
    for rel, sha in originals.items():
        copy = dest / rel
        if not copy.is_file() or _sha256(copy) != sha:
            raise Refused(f'the backup copy of sources/{rel} does not match its original')
    return originals


# --- the clone, the snapshot and the push source -------------------------------------------------------------------

def make_clone(repo: Path, work: Path, rev: str = 'main') -> Path:
    """git clone --no-local --single-branch --no-tags --branch <rev> <repo> <work>/clean. Only reads repo."""
    if _inside(work, repo):
        raise Refused('--work must be outside the repo')
    work = work.resolve()
    clean = work / 'clean'
    if clean.exists():
        raise Refused('--work already holds a clean/ clone: give a new --work folder')
    work.mkdir(parents=True, exist_ok=True)
    _git(work, 'clone', '--quiet', '--no-local', '--single-branch', '--no-tags', '--branch', rev, '--',
         str(repo.resolve()), str(clean))
    return clean


def signing_configured(repo: Path) -> bool:
    """Is git in repo set to sign commits? commit.gpgsign as git reads it there (system, global, local). A value
    git can't read as a boolean counts as set: the tool never guesses past a signing config."""
    r = _run(repo, 'config', '--type=bool', '--get', 'commit.gpgsign')
    if r.returncode == 1:                       # not set anywhere
        return False
    return r.returncode != 0 or r.stdout.decode('utf-8', 'replace').strip() != 'false'


def build_snapshot(clone: Path, user: str, email: str, rev: str = 'main', parent: str | None = None,
                   remote: str | None = None) -> str:
    """One commit of <rev>^{tree} in the clone, authored and committed as user <email>, on parent (checked to be
    the remote's main) or on nothing. Sets the clone's SNAPSHOT_BRANCH to it and returns its sha. Refuses with
    SIGNING_REFUSAL when git is set to sign, or when git fails while signing: it never signs and never skips it."""
    if signing_configured(clone):
        raise Refused(SIGNING_REFUSAL)
    if parent and not remote:
        raise Refused("--parent needs --remote, to check that it is the published main")
    fetched = None
    if remote:
        _git(clone, 'fetch', '--quiet', '--no-tags', remote, 'main')
        fetched = _gits(clone, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}')
        if not parent:
            raise Refused("the remote already has a main: pass its sha as --parent")
        r = _run(clone, 'rev-parse', '--verify', '-q', f'{parent}^{{commit}}')
        if r.returncode != 0 or r.stdout.decode().strip() != fetched:
            raise Refused("--parent is not the remote's main: give the sha of the last published commit")
    identity = dict(GIT_AUTHOR_NAME=user, GIT_COMMITTER_NAME=user, GIT_AUTHOR_EMAIL=email, GIT_COMMITTER_EMAIL=email)
    args = ['commit-tree']
    if fetched:
        args += ['-p', fetched]
    args += ['-m', SNAPSHOT_MESSAGE, f'{rev}^{{tree}}']
    try:
        sha = _gits(clone, *args, env=identity)
    except GitError as e:
        if _SIGNING_ERROR.search(str(e)):
            raise Refused(SIGNING_REFUSAL) from e
        raise
    _git(clone, 'branch', '-f', SNAPSHOT_BRANCH, sha)
    return sha


def _cut_down(clone: Path) -> None:
    """Leave the build clone nothing but refs/heads/publish: no other branch, no tag, and no remote (whose URL is
    this repo's absolute path), so even a slip of -C clean can push no more than the snapshot."""
    ref = f'refs/heads/{SNAPSHOT_BRANCH}'
    _git(clone, 'symbolic-ref', 'HEAD', ref)
    if _run(clone, 'remote', 'get-url', 'origin').returncode == 0:
        _git(clone, 'remote', 'remove', 'origin')
    for other in _gits(clone, 'for-each-ref', '--format=%(refname)').split():
        if other != ref:
            _git(clone, 'update-ref', '-d', other)


def make_push_source(clone: Path, work: Path, snap: str) -> Path:
    """Cut the build clone down first. Then build the push source under a temporary name inside work
    (UNSCANNED_PREFIX…): a fresh bare repo holding only refs/heads/publish at snap, and the objects it reaches (the
    snapshot, and the published parents fetched from --remote); no tag, no other ref, no remote. It is not named
    push.git here: name_push_source() does that only after a clean scan. On any failure it removes what it made."""
    ref = f'refs/heads/{SNAPSHOT_BRANCH}'
    _cut_down(clone)
    unscanned = Path(tempfile.mkdtemp(prefix=UNSCANNED_PREFIX, dir=work.resolve()))
    try:
        _git(work, 'init', '--quiet', '--bare', f'--initial-branch={SNAPSHOT_BRANCH}', str(unscanned))
        _git(unscanned, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', str(clone.resolve()),
             f'{ref}:{ref}')
        if _gits(unscanned, 'rev-parse', '--verify', f'{ref}^{{commit}}') != snap:
            raise Refused('the push source does not hold the snapshot')
    except BaseException:
        remove_push_source(unscanned)
        raise
    return unscanned


def name_push_source(unscanned: Path, work: Path) -> Path:
    """After a clean scan: rename the temporary push source to <work>/push.git, the only place to push from."""
    final = work.resolve() / PUSH_SOURCE
    if final.exists():
        raise Refused(f'--work already holds a {PUSH_SOURCE}: give a new --work folder')
    unscanned.rename(final)
    return final


def remove_push_source(unscanned: Path | None) -> bool:
    """Remove a temporary push source this tool made (its name starts with UNSCANNED_PREFIX; nothing else is ever
    removed). Git keeps packs read-only, so each file is made writable first. If it can't be removed, its publish
    ref is deleted at least. True when it is gone."""
    if unscanned is None or not unscanned.exists():
        return True
    if not unscanned.name.startswith(UNSCANNED_PREFIX):
        raise Refused('refusing to remove a folder this tool did not make')

    def writable(func, path, _exc):
        os.chmod(path, stat.S_IWRITE)
        func(path)
    try:
        shutil.rmtree(unscanned, onexc=writable)
    except OSError:
        pass
    if unscanned.exists():
        _withdraw(unscanned)
        return False
    return True


def _withdraw(*repos: Path | None) -> None:
    """Delete the publish ref wherever it is, so a refused snapshot is never left ready to push."""
    ref = f'refs/heads/{SNAPSHOT_BRANCH}'
    for repo in repos:
        if repo is not None and repo.exists() and _run(repo, 'rev-parse', '--verify', '-q', ref).returncode == 0:
            _run(repo, 'update-ref', '-d', ref)


def _push_source_problems(push: Path, clone: Path, snap: str) -> list[str]:
    ref = f'refs/heads/{SNAPSHOT_BRANCH}'
    problems = []
    if _gits(push, 'for-each-ref', '--format=%(refname) %(objectname)') != f'{ref} {snap}':
        problems.append(f'the push source holds a ref other than {ref} at the snapshot')
    if _run(push, 'symbolic-ref', '-q', 'HEAD').stdout.decode().strip() != ref:
        problems.append(f"the push source's HEAD is not {ref}")
    if _gits(push, 'rev-list', '--all').split() != _gits(push, 'rev-list', snap).split():
        problems.append('the push source reaches commits beyond the snapshot and its parents')
    stored = set(_gits(push, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split())
    reachable = {line.split()[0] for line in _gits(push, 'rev-list', '--objects', '--all').splitlines() if line}
    if stored != reachable:
        problems.append('the push source stores objects beyond the snapshot and its parents')
    if _run(push, 'config', '--get-regexp', r'^remote\.').returncode == 0:
        problems.append('the push source has a remote')
    if _gits(clone, 'for-each-ref', '--format=%(refname)') != ref:
        problems.append(f'the build clone holds a ref other than {ref}')
    if _run(clone, 'config', '--get-regexp', r'^remote\.').returncode == 0:
        problems.append('the build clone still has a remote')
    return problems


# --- the scan ------------------------------------------------------------------------------------------------------

def ignored_dirs(repo: Path, rev: str | None = None) -> list[str]:
    """The directory patterns (lines ending '/') in repo/.gitignore, and in <rev>:.gitignore when rev is given.
    .superpowers/ comes first."""
    texts = []
    gi = repo / '.gitignore'
    if gi.is_file():
        texts.append(gi.read_text(encoding='utf-8', errors='replace'))
    if rev:
        r = _run(repo, 'show', f'{rev}:.gitignore')
        if r.returncode == 0:
            texts.append(r.stdout.decode('utf-8', 'replace'))
    dirs: list[str] = []
    for text in texts:
        for line in text.splitlines():
            s = line.strip()
            if s and not s.startswith(('#', '!')) and s.endswith('/') and s not in dirs:
                dirs.append(s)
    return sorted(dirs, key=lambda d: d != '.superpowers/')


def _under(path: str, pattern: str) -> bool:
    """Is path inside a directory the .gitignore pattern names? Case-insensitive, as git is on Windows."""
    pat = pattern.strip('/').lower()
    dirs = path.lower().split('/')[:-1]
    if pattern.startswith('/') or '/' in pat:          # anchored at the root
        n = pat.count('/') + 1
        return len(dirs) >= n and fnmatch.fnmatchcase('/'.join(dirs[:n]), pat)
    return any(fnmatch.fnmatchcase(d, pat) for d in dirs)


def _git_ignored(repo: Path, paths: list[str]) -> set[str]:
    """The paths git would ignore in repo, by every source it reads: each .gitignore, info/exclude and
    core.excludesFile. --no-index, so a tracked path is judged too."""
    if not paths:
        return set()
    r = _run(repo, 'check-ignore', '--no-index', '--stdin', '-z',
             stdin=b''.join(p.encode('utf-8') + b'\0' for p in paths))
    if r.returncode == 1:
        return set()
    if r.returncode != 0:
        raise GitError(f'git check-ignore failed (exit {r.returncode}): {r.stderr.decode("utf-8", "replace")}')
    return {p for p in r.stdout.decode('utf-8', 'replace').split('\0') if p}


_HIT_MARKER = re.compile(r'\bmarker #(\d+) \(')


def unwaivable(m: Marker) -> bool:
    """A whole value, which no --allow-file waiver ever skips: a full email, a full name, an OS user name, an extra
    marker or the GitHub username (github_user_marker). Only a part of one (an email's local part, a name's word) or a
    profile path can be waived."""
    return m.origin not in ('email local part', 'name word')


def _waivable(hit: str, markers: list[Marker]) -> bool:
    mo = _HIT_MARKER.search(hit)
    if mo is None:
        return True                             # a profile path, whoever's it is
    n = int(mo.group(1))
    return not (1 <= n <= len(markers) and unwaivable(markers[n - 1]))


def scan_tree(git_dir: Path, tree_ish: str, markers: list[Marker], ignored: list[str], *,
              ignore_repo: Path | None = None, allow: list[str] | tuple[str, ...] = (),
              waived: list[str] | None = None, unused: list[str] | None = None) -> list[str]:
    """Every blob path in tree_ish: under sources/; under an ignored directory (.superpowers/ first), or ignored by
    git in ignore_repo; over MAX_BLOB_BYTES; a compressed container; a marker in its path; a marker or a profile
    path in its content. Problems name the path (masked) and the line. Content hits in an `allow` file go to
    `waived` instead, except a whole value's (unwaivable), which stays a problem. Each `allow` path that waived
    nothing, in the tree or not, goes to `unused`."""
    out = _git(git_dir, 'ls-tree', '-r', '-z', '--long', '--full-tree', tree_ish)
    order = sorted(ignored, key=lambda d: d != '.superpowers/')
    entries = []
    for rec in out.split(b'\0'):
        if rec:
            meta, _, raw = rec.partition(b'\t')
            _mode, kind, sha, size = meta.decode().split()
            entries.append((raw.decode('utf-8', 'replace'), kind, sha, size))
    git_ignored = _git_ignored(ignore_repo, [e[0] for e in entries]) if ignore_repo else set()
    allowed = {a.replace('\\', '/').strip('/') for a in allow}
    used: set[str] = set()
    problems: list[str] = []
    blobs: list[tuple[str, str]] = []
    for path, kind, sha, size in entries:
        where = shown(path, markers)
        if kind != 'blob':
            problems.append(f'{where}: a {kind} entry, not a file')
            continue
        under = next((d for d in order if _under(path, d)), None)
        if path.lower().startswith('sources/'):
            problems.append(f'{where}: a sources/ path')
        elif under:
            problems.append(f'{where}: under the gitignored {under}')
        elif path in git_ignored:
            problems.append(f'{where}: a path git ignores here (.gitignore, info/exclude or core.excludesFile)')
        ext = Path(path).suffix.lower()
        if ext in _CONTAINERS:
            problems.append(f"{where}: a compressed {ext} file the scan can't read inside")
        if int(size) > MAX_BLOB_BYTES:
            problems.append(f'{where}: {int(size)} bytes, over the {MAX_BLOB_BYTES}-byte limit')
        else:
            blobs.append((path, sha))
        for i, m in enumerate(markers):
            if _marker_rx(m).search(path):
                problems.append(f'{where}: marker {mask(m, i + 1)} in the path')
    by_sha: dict[str, list[str]] = {}
    for path, sha in blobs:
        by_sha.setdefault(sha, []).append(path)
    for sha, data in _objects(git_dir, list(by_sha)):
        for path in by_sha[sha]:
            hits = _blob_hits(path, data, markers)
            if path in allowed:
                waivable = [h for h in hits if _waivable(h, markers)]
                problems += [h for h in hits if h not in waivable]
                if waivable:
                    used.add(path)
                if waived is not None:
                    waived.extend(waivable)
            else:
                problems += hits
    if unused is not None:
        unused.extend(a for a in sorted(allowed) if a not in used)
    return problems


_IDENT_LINE = re.compile(r'(?P<key>author|committer) (?P<name>[^<>\n]*) <(?P<email>[^<>\n]*)> (?P<when>[^<>\n]*)')
_SHA_HEADER = re.compile(r'(?:tree|parent) (?:[0-9a-f]{64}|[0-9a-f]{40})')


def _ident_text(line: str, identity: tuple[str, str] | None) -> str:
    """The text of an author or committer line to scan. Under --allow-github-user-overlap (identity: the username and
    its noreply address), a line whose name is exactly the username and whose email is exactly that address is
    scanned without those two strings: the only place where the values the username overlaps may stand. Its date is
    still scanned, and a line with any other name or email is scanned whole."""
    if identity is not None:
        mo = _IDENT_LINE.fullmatch(line)
        if mo and mo['name'] == identity[0] and mo['email'] == identity[1]:
            return f"{mo['key']} <> {mo['when']}"
    return line


def scan_commits(clone: Path, rev: str, markers: list[Marker],
                 identity: tuple[str, str] | None = None) -> list[str]:
    """Every commit reachable from rev: a marker or a profile path in its message, or in any header line but its
    tree and parent shas (author, committer, and any other: encoding, mergetag, …); a signature header. identity,
    given only under --allow-github-user-overlap, is (--github-user, its noreply address): the one name and email an
    author or committer line may hold although a marker overlaps them (_ident_text)."""
    shas = _gits(clone, 'rev-list', rev).split()
    problems: dict[str, None] = {}
    for sha, raw in _objects(clone, shas):
        head, _, message = raw.partition(b'\n\n')
        short = sha[:12]
        for line in head.decode('utf-8', 'replace').split('\n'):
            key = line.split(' ', 1)[0]
            if key in ('gpgsig', 'gpgsig-sha256'):
                problems.setdefault(f"commit {short}: signed ({key}); a signature names its key's owner", None)
            if _SHA_HEADER.fullmatch(line):
                continue
            if key in ('author', 'committer'):
                text, where = _ident_text(line, identity), f'its {key}'
            else:
                text, where = line, 'another of its header lines'
            for _pos, what in _hits_in_text(text, markers):
                problems.setdefault(f'commit {short}: {what} in {where}', None)
        for _pos, what in _hits_in_text(message.decode('utf-8', 'replace'), markers):
            problems.setdefault(f'commit {short}: {what} in its message', None)
    return list(problems)


def verify(repo: Path, clone: Path, snap: str, before: str, user: str, email: str, parent: str | None,
           markers: list[Marker], rev: str = 'main', *, push: Path | None = None,
           allow: list[str] | tuple[str, ...] = (), waived: list[str] | None = None,
           unused: list[str] | None = None, identity: tuple[str, str] | None = None) -> Report:
    """Scan what will be pushed (push, else the clone) and check the snapshot's identity, message, parents and tree,
    the push source's contents, and this repo's state against `before`. identity is scan_commits' (only under
    --allow-github-user-overlap)."""
    src = push or clone
    problems = scan_tree(src, snap, markers, ignored_dirs(clone, snap), ignore_repo=repo, allow=allow,
                         waived=waived, unused=unused)
    problems += scan_commits(src, snap, markers, identity)
    an, ae, cn, ce, parents, body = _gits(src, 'log', '-1', '--format=%an%x00%ae%x00%cn%x00%ce%x00%P%x00%B',
                                          snap).split('\0', 5)
    if an != user or cn != user:
        problems.append("the snapshot's author or committer name is not --github-user")
    if ae != email or ce != email:
        problems.append("the snapshot's author or committer email is not --github-user's noreply address")
    if body.strip() != SNAPSHOT_MESSAGE:
        problems.append(f"the snapshot's message is not '{SNAPSHOT_MESSAGE}'")
    want: list[str] = []
    if parent:
        r = _run(src, 'rev-parse', '--verify', '-q', f'{parent}^{{commit}}')
        want = [r.stdout.decode().strip() if r.returncode == 0 else parent]
    if parents.split() != want:
        problems.append("the snapshot's parent is not --parent" if parent else 'the snapshot has a parent')
    if push is not None:
        problems += _push_source_problems(push, clone, snap)
    tree_equal = _gits(src, 'rev-parse', f'{snap}^{{tree}}') == _gits(repo, 'rev-parse', f'{rev}^{{tree}}')
    (refs_before, wt_before), (refs_after, wt_after) = _halves(before), _halves(state_of(repo))
    return Report(snapshot=snap, parent=want[0] if want else None, tree_equal=tree_equal,
                  refs_untouched=refs_before == refs_after, worktree_untouched=wt_before == wt_after,
                  problems=problems)


# --- printing ------------------------------------------------------------------------------------------------------

def _msys(p: Path) -> str:
    s = p.as_posix()
    return f'/{s[0].lower()}{s[2:]}' if len(s) > 1 and s[1] == ':' else s


def _relative(text: str, places: dict[str, Path]) -> str:
    """Every absolute path the tool knows, in each spelling git or Python prints, becomes its label."""
    pairs = []
    for label, p in [*places.items(), ('$TEMP', Path(tempfile.gettempdir())), ('~', Path.home())]:
        for form in {str(p), p.as_posix(), _msys(p), str(p).replace('\\', '\\\\')}:
            if len(form) > 3:
                pairs.append((form, label))
    for form, label in sorted(pairs, key=lambda fl: -len(fl[0])):
        text = re.sub(re.escape(form), lambda _mo, lab=label: lab, text, flags=re.I)
    return text


def _markers_line(markers: list[Marker]) -> str:
    masks = ', '.join(mask(m, i + 1) for i, m in enumerate(markers)) or 'none'
    skipped = getattr(markers, 'short_skipped', 0)
    return f'markers read at runtime: {len(markers)}: {masks}; {skipped} of 3 characters or fewer skipped'


def _kinds(found: list[Marker]) -> str:
    return '; '.join(f'a local {m.origin or m.kind}, {len(m.value)} chars' for m in found)


def _overlap_refusal(found: list[Marker]) -> str:
    return (f'your GitHub username (--github-user) overlaps, or is equal to, {len(found)} value(s) read on this '
            f'machine: {_kinds(found)}. Publishing under it would put that value in the public repo, and the tool will '
            'not drop a marker to let it pass. Nothing was built. Decide with the user: publish under another GitHub '
            'username, or change that local value, then run it again. Only if the username is the user\'s own and they '
            'accept that it shows publicly, as the repo\'s owner and as the snapshot\'s author and committer, run it '
            'again with --allow-github-user-overlap: their explicit choice, never a default.')


def _noreply_overlap_refusal(found: list[Marker]) -> str:
    return (f'{len(found)} value(s) read on this machine overlap the noreply address but not the GitHub username '
            f'itself: {_kinds(found)}. --allow-github-user-overlap accepts only values the username overlaps, so '
            'nothing was built. Decide with the user: change that local value, or drop --github-id if the value is in '
            'the id, then run it again.')


def _overlap_accepted(found: list[Marker]) -> str:
    what = (f'overlaps, or is equal to, {len(found)} value(s) read on this machine: {_kinds(found)}. The user accepted '
            'this (--allow-github-user-overlap)' if found else
            'overlaps no value read on this machine, so --allow-github-user-overlap accepts nothing')
    return (f'notice: your GitHub username (--github-user) {what}. Only the snapshot\'s author and committer name '
            '(the username) and their email (its noreply address) may hold it. The username is a marker now too, '
            'unwaivable: the tree, every commit message and every other field are refused on it, on each value it '
            'overlaps, and on every other marker.')


def _say_unused(unused: list[str], say) -> None:
    for a in unused:
        say(f'  - warning: --allow-file {a} waives nothing: check its path, or drop the waiver')


def _scan_only(repo: Path, rev: str, markers: list[Marker], allow: list[str], say) -> int:
    waived: list[str] = []
    unused: list[str] = []
    problems = scan_tree(repo, f'{rev}^{{tree}}', markers, ignored_dirs(repo, rev), ignore_repo=repo, allow=allow,
                         waived=waived, unused=unused)
    say(f'scan of {rev}^{{tree}}: {len(problems)} problem(s), {len(waived)} waived')
    for p in problems:
        say(f'  - {p}')
    for w in waived:
        say(f'  - waived (--allow-file): {w}')
    _say_unused(unused, say)
    say('result: clean' if not problems else 'result: REFUSED: remove each hit in a commit, then scan again')
    return 0 if not problems else 1


def _say_report(report: Report, rev: str, user: str, waived: list[str], say, unused: list[str] = ()) -> None:
    yes = {True: 'yes', False: 'NO'}
    say(f'snapshot: {report.snapshot} on branch {SNAPSHOT_BRANCH} in {PUSH_SOURCE}/ (built in clean/)' if report.ok
        else f'snapshot: {report.snapshot}, refused: it is never named {PUSH_SOURCE}/')
    say(f'author and committer: {user}, with its noreply address')
    say(f'parent: {report.parent or "none"}')
    say(f'tree equal to {rev}^{{tree}}: {yes[report.tree_equal]}')
    say(f'refs untouched: {yes[report.refs_untouched]}')
    say(f'working tree untouched: {yes[report.worktree_untouched]}')
    say(f'problems: {len(report.problems)}')
    for p in report.problems:
        say(f'  - {p}')
    say(f'waived (--allow-file): {len(waived)}')
    for w in waived:
        say(f'  - {w}')
    _say_unused(list(unused), say)
    say(f'result: OK: push {SNAPSHOT_BRANCH} from {PUSH_SOURCE}/ as main' if report.ok
        else 'result: REFUSED: never push this snapshot')


class _Arguments(argparse.ArgumentParser):
    def error(self, message: str):              # never echo an argument back: it might hold a marker
        if 'unrecognized arguments' in message:
            message = 'unrecognized arguments (not echoed)'
        raise Refused(f'arguments: {message}')


def _parser() -> argparse.ArgumentParser:
    ap = _Arguments(prog='publish_history.py',
                    description='Build and scan one snapshot commit for the public repo. Never pushes.')
    ap.add_argument('--github-user')
    ap.add_argument('--github-id')
    ap.add_argument('--allow-github-user-overlap', action='store_true',
                    help="the user's explicit choice when their GitHub username holds their own name: the username "
                         "and its noreply address may stand as the snapshot's author and committer, and nowhere else")
    ap.add_argument('--parent')
    ap.add_argument('--remote')
    ap.add_argument('--work')
    ap.add_argument('--backup')
    ap.add_argument('--repo', default='.')
    ap.add_argument('--rev', default='main')
    ap.add_argument('--scan-only', action='store_true')
    ap.add_argument('--extra-marker', action='append', default=[], help='one more value to refuse; repeatable')
    ap.add_argument('--extra-marker-file', action='append', default=[],
                    help='a file outside the repo with one more value to refuse on each line, read at runtime and '
                         'never printed; repeatable')
    ap.add_argument('--allow-file', action='append', default=[],
                    help='a tracked file whose content hits are known safe: they are waived and listed; repeatable')
    return ap


def main(argv: list[str] | None = None) -> int:
    places: dict[str, Path] = {}
    masks: list[Marker] = []
    clone = unscanned = None
    ok = False

    def say(text: str) -> None:
        print(shown(_relative(text, places), masks))

    try:
        masks = [Marker('user', n) for n in sorted(os_user_names()) if len(n) >= MIN_MARKER]
        args = _parser().parse_args(argv)
        if args.allow_github_user_overlap and not args.github_user:
            raise Refused("--allow-github-user-overlap needs --github-user: it lets only that username, and its "
                          "noreply address, stand as the snapshot's author and committer")
        gh = github_user_marker(args.github_user) if args.allow_github_user_overlap else None
        if gh:
            masks.append(gh)
        repo = Path(args.repo).resolve()
        places['<repo>'] = repo
        extra = [*args.extra_marker, *read_marker_files(args.extra_marker_file, repo)]
        markers = personal_markers(repo, {args.github_user} if args.github_user else set(), extra)
        known = {_key(m.value) for m in markers}
        # gh sits right after the markers, so it is numbered the same here and once it joins them below
        masks = [*markers, *([gh] if gh else []), *markers.allowed_matches,
                 *(m for m in masks if m is not gh and _key(m.value) not in known)]
        say(_markers_line(markers))
        identity = None
        if args.github_user:                    # before anything is built: the username against every marker
            email = noreply_email(args.github_user, args.github_id)
            found = github_user_overlaps(args.github_user, email, [*markers.allowed_matches, *markers])
            if found and not gh:
                raise Refused(_overlap_refusal(found))
            if gh:                              # the user's explicit choice: the username holds their name
                beyond = [m for m in found if not overlaps_username(args.github_user, m)]
                if beyond:
                    raise Refused(_noreply_overlap_refusal(beyond))
                markers.append(gh)
                identity = (args.github_user, email)
                say(_overlap_accepted(found))
        if args.scan_only:
            ok = True
            return _scan_only(repo, args.rev, markers, args.allow_file, say)
        if not (args.github_user and args.work and args.backup):
            raise Refused('a publish needs --github-user, --work and --backup (or use --scan-only)')
        if bool(args.parent) != bool(args.remote):
            raise Refused('--parent and --remote go together: the remote main is checked against the parent')
        if signing_configured(repo):             # this repo's own config too, which the clone doesn't inherit
            raise Refused(SIGNING_REFUSAL)
        work, backup = Path(args.work).resolve(), Path(args.backup).resolve()
        for flag, p in (('--work', work), ('--backup', backup)):
            if _inside(p, repo):
                raise Refused(f'{flag} must be outside the repo')
        if _inside(backup, work) or _inside(work, backup):   # the backup must outlive the --work folder's deletion
            raise Refused('--backup and --work must be apart: neither inside the other, nor the same folder. Keep the '
                          'backup somewhere lasting, since --work is deleted after the push')
        if (work / 'clean').exists() or (work / PUSH_SOURCE).exists():
            raise Refused(f'--work already holds clean/ or {PUSH_SOURCE}: give a new --work folder')
        places.update({'<work>': work, '<backup>': backup})

        before = state_of(repo)
        copied = backup_sources(repo, backup)
        say(f'backup: {len(copied)} file(s) from sources/ copied to --backup, each re-hashed and matching'
            if copied else 'backup: no sources/ folder in this repo, nothing to copy')
        clone = make_clone(repo, work, args.rev)
        say(f'clone: clean/ inside --work, a --no-local --single-branch clone of {args.rev}')
        snap = build_snapshot(clone, args.github_user, email, args.rev, args.parent, args.remote)
        unscanned = make_push_source(clone, work, snap)
        say(f'push source: a fresh bare repo holding only refs/heads/{SNAPSHOT_BRANCH}, built under a temporary name '
            f'and named {PUSH_SOURCE}/ only after a clean scan')
        waived: list[str] = []
        unused: list[str] = []
        report = verify(repo, clone, snap, before, args.github_user, email, args.parent, markers, args.rev,
                        push=unscanned, allow=args.allow_file, waived=waived, unused=unused, identity=identity)
        if report.ok:
            name_push_source(unscanned, work)
            unscanned = None
            ok = True
        _say_report(report, args.rev, args.github_user, waived, say, unused)
        return 0 if ok else 1
    except KeyboardInterrupt:
        say('stopped: interrupted')
        return 130
    except (Refused, GitError, ValueError, OSError) as e:
        say(f'refused: {e}')
        return 1
    except Exception as e:                       # anything else: masked, and never a traceback
        say(f'error: {type(e).__name__}: {e}')
        return 1
    finally:
        if not ok and clone is not None:         # a refusal or any failure after the clone: nothing left to push
            try:
                gone = remove_push_source(unscanned)
                _withdraw(clone)
                say('nothing is left to push: no push.git was made, the unscanned push source is removed, and '
                    'publish is not in clean/' if gone else
                    'nothing is left to push: the unscanned push source could not be removed, so its publish ref '
                    'was deleted, and publish is not in clean/')
            except Exception as e:
                say(f'error while cleaning up: {type(e).__name__}: {e}. Delete the --work folder; push nothing.')


if __name__ == '__main__':
    sys.exit(main())
