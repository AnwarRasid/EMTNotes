"""tools/publish_history.py on toy repos built in tmp_path.

Every identity here is made up: "Toy Person", "toy.person@example.test", the OS username "toyuser" (patched in) and
the GitHub user "dry-run-user", plus a few more toy names below. No real value is read: git runs with a toy HOME
(so a toy global config and no global ignore file), every GIT_* variable is removed, and the OS user names are
patched before the tool can read them. Profile paths are built at runtime, so this file's text holds none.
"""
import hashlib
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import zlib
from pathlib import Path

import pytest

import publish_history as ph

TOY_NAME = 'Toy Person'
TOY_WORD = 'Person'                       # the name's only word of 4 letters or more
TOY_EMAIL = 'toy.person@example.test'
TOY_LOCAL = 'toy.person'                  # the email's local part
TOY_USER = 'toyuser'
GH = 'dry-run-user'
GH_EMAIL = 'dry-run-user@users.noreply.github.com'
LEAKS = (TOY_NAME, TOY_WORD, TOY_EMAIL, TOY_LOCAL, TOY_USER)
MASKED = re.compile(r'#\d+ \((email|name|user|extra), \d+ chars\)')
REAL_OS_USERNAME = ph.os_username
REAL_OS_USER_NAMES = getattr(ph, 'os_user_names', None)
REPO = Path(__file__).parents[2]
PAGES_URL = re.compile(r'''https?://[^\s)'"\]]*github\.io''', re.I)
GLOBAL_CONFIG = '[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n'


def win_profile(user: str, sep: str = '\\') -> str:
    return sep.join(['C:', 'Users', user])


def msys_profile(user: str) -> str:
    return '/'.join(['', 'c', 'Users', user])


def mac_profile(user: str) -> str:
    return '/'.join(['', 'Users', user])


def home_profile(user: str) -> str:
    return '/'.join(['', 'home', user])


@pytest.fixture(autouse=True)
def toy_identity(tmp_path_factory, monkeypatch):
    """Git reads a toy HOME (global config, no global ignore file), never the machine's; no GIT_* variable is
    inherited; and the OS user names are toy ones."""
    home = tmp_path_factory.mktemp('home')
    (home / '.gitconfig').write_text(GLOBAL_CONFIG, encoding='utf-8')
    (home / '.config' / 'git').mkdir(parents=True)
    for var in [k for k in os.environ if k.upper().startswith('GIT_')]:
        monkeypatch.delenv(var)
    monkeypatch.setenv('HOME', str(home))
    monkeypatch.setenv('XDG_CONFIG_HOME', str(home / '.config'))
    monkeypatch.setattr(ph, 'os_username', lambda: TOY_USER)
    monkeypatch.setattr(ph, 'os_user_names', lambda: {ph.os_username()}, raising=False)


def global_config() -> Path:
    return Path(os.environ['HOME']) / '.gitconfig'


def git(repo, *args, check=True) -> str:
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, encoding='utf-8')
    if check and r.returncode != 0:
        raise AssertionError(f'git {args[0]} failed: {r.stderr}')
    return r.stdout.strip()


def bare(path: Path) -> Path:
    subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(path)], check=True)
    return path


def make_toy(root: Path, name='toy', who=TOY_NAME, email=TOY_EMAIL) -> Path:
    """Commit 1 adds app.txt and sources/notes.pdf; commit 2 ignores sources/ and .superpowers/ and untracks
    sources/ (the file stays on disk); commit 3 edits app.txt, with an untracked .superpowers/ledger.md on disk.
    Every commit is by `who` <`email`>."""
    toy = root / name
    toy.mkdir()
    subprocess.run(['git', 'init', '-q', '-b', 'main', str(toy)], check=True)
    git(toy, 'config', 'user.name', who)
    git(toy, 'config', 'user.email', email)
    git(toy, 'config', 'commit.gpgsign', 'false')
    (toy / 'app.txt').write_text('version one\n', encoding='utf-8')
    (toy / 'sources').mkdir()
    (toy / 'sources' / 'notes.pdf').write_bytes(b'%PDF-1.4 toy notes\n')
    git(toy, 'add', 'app.txt', 'sources/notes.pdf')
    git(toy, 'commit', '-q', '-m', 'add the app and the notes')
    (toy / '.gitignore').write_text('sources/\n.superpowers/\n', encoding='utf-8')
    git(toy, 'add', '.gitignore')
    git(toy, 'rm', '-q', '--cached', '-r', 'sources')
    git(toy, 'commit', '-q', '-m', 'keep sources/ on this PC only')
    (toy / 'app.txt').write_text('version two\n', encoding='utf-8')
    (toy / '.superpowers').mkdir()
    (toy / '.superpowers' / 'ledger.md').write_text('ledger\n', encoding='utf-8')
    git(toy, 'commit', '-q', '-am', 'edit the app')
    return toy


def add_file(toy: Path, path: str, content: str | bytes, force=False):
    p = toy / path
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        p.write_bytes(content)
    else:
        p.write_text(content, encoding='utf-8', newline='\n')
    git(toy, 'add', *(['-f'] if force else []), path)
    git(toy, 'commit', '-q', '-m', f'add {path}')


def run(capsys, *args) -> tuple[int, str]:
    code = ph.main([*args])
    cap = capsys.readouterr()
    return code, cap.out + cap.err


def publish_args(toy, work, backup, *extra):
    return ['--github-user', GH, '--work', str(work), '--backup', str(backup), '--repo', str(toy), *extra]


def assert_no_leak(out: str, *values: str):
    low = out.lower()
    for v in values or LEAKS:
        assert v.lower() not in low, 'a marker value was printed'


# --- the noreply address -------------------------------------------------------------------------------------------

def test_noreply_email_builds_githubs_address_with_or_without_the_id():
    assert ph.noreply_email('dry-run-user') == 'dry-run-user@users.noreply.github.com'
    assert ph.noreply_email('dry-run-user', '123') == '123+dry-run-user@users.noreply.github.com'


@pytest.mark.parametrize('bad', ['bad user', '-lead', 'trail-', '', 'x' * 40, 'a_b', 'a@b'])
def test_noreply_email_refuses_what_is_not_a_github_username(bad):
    with pytest.raises(ValueError):
        ph.noreply_email(bad)


def test_noreply_email_refuses_an_id_that_is_not_a_number():
    with pytest.raises(ValueError):
        ph.noreply_email('dry-run-user', '12a')


def test_os_username_is_the_login_else_the_home_folder_name(monkeypatch):
    monkeypatch.setattr(ph.os, 'getlogin', lambda: 'fakelogin')
    assert REAL_OS_USERNAME() == 'fakelogin'

    def no_login():
        raise OSError('no controlling terminal')
    monkeypatch.setattr(ph.os, 'getlogin', no_login)
    monkeypatch.setattr(ph.Path, 'home', classmethod(lambda cls: Path('/', 'home', 'fakehome')))
    assert REAL_OS_USERNAME() == 'fakehome'


def test_os_user_names_are_the_login_the_home_folder_and_both_username_variables(monkeypatch):
    monkeypatch.setattr(ph.os, 'getlogin', lambda: 'fakelogin')
    monkeypatch.setattr(ph, 'os_username', REAL_OS_USERNAME)
    monkeypatch.setattr(ph.Path, 'home', classmethod(lambda cls: Path('/', 'home', 'fakehome')))
    monkeypatch.setenv('USERNAME', 'fakevar')
    monkeypatch.setenv('USER', 'fakeunix')
    assert REAL_OS_USER_NAMES() == {'fakelogin', 'fakehome', 'fakevar', 'fakeunix'}


# --- the markers ---------------------------------------------------------------------------------------------------

def test_markers_hold_the_email_its_local_part_the_name_its_words_and_the_user(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH})
    assert {m.kind for m in markers} == {'email', 'name', 'user'}
    assert {m.value for m in markers} == {TOY_NAME, TOY_WORD, TOY_EMAIL, TOY_LOCAL, TOY_USER}
    for n, m in enumerate(markers, 1):
        masked = ph.mask(m, n)
        assert masked == f'#{n} ({m.kind}, {len(m.value)} chars)'
        assert_no_leak(masked)


def test_markers_skip_noreply_addresses_and_short_values_and_set_aside_the_github_user(tmp_path):
    toy = make_toy(tmp_path)
    for name, email in [(GH, GH_EMAIL), ('Bot Helper', 'noreply@example.test'), ('Al', 'al@ex.test')]:
        (toy / 'app.txt').write_text(f'by {name}\n', encoding='utf-8')
        git(toy, '-c', f'user.name={name}', '-c', f'user.email={email}', 'commit', '-q', '-am', 'more')
    markers = ph.personal_markers(toy, {GH})
    values = {m.value for m in markers}
    assert GH not in values and GH_EMAIL not in values and 'noreply@example.test' not in values
    assert 'user' not in values, "a word of the GitHub user's own name is no marker"
    assert {'Bot Helper', 'Helper', 'al@ex.test'} <= values
    assert 'Al' not in values and 'al' not in values
    assert markers.short_skipped == 1
    assert [(m.kind, m.value) for m in markers.allowed_matches] == [('name', GH)]


def test_markers_read_every_identity_even_one_only_a_reflog_a_tag_or_a_hidden_config_holds(tmp_path):
    toy = make_toy(tmp_path)
    git(toy, '-c', 'user.name=Reflog Only', '-c', 'user.email=reflog.only@example.test', 'commit', '-q',
        '--allow-empty', '-m', 'soon amended')
    git(toy, 'commit', '-q', '--amend', '--reset-author', '--allow-empty', '-m', 'amended')
    git(toy, '-c', 'user.name=Tag Maker', '-c', 'user.email=tag.maker@example.test', 'tag', '-a', 'v1', '-m', 'v1')
    global_config().write_text(GLOBAL_CONFIG + '[user]\n\tname = Hidden Global\n\temail = hidden.global@example.test\n'
                               '[author]\n\tname = Author Config\n', encoding='utf-8')
    values = {m.value for m in ph.personal_markers(toy, {GH})}
    assert {'Reflog Only', 'reflog.only@example.test', 'Tag Maker', 'tag.maker@example.test', 'Hidden Global',
            'hidden.global@example.test', 'Author Config', 'Hidden', 'Global', 'Maker', 'Reflog', 'Author',
            'Config'} <= values


def test_extra_markers_join_the_list_as_their_own_kind(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH}, extra=['Quillon', 'ab'])
    assert ('extra', 'Quillon') in {(m.kind, m.value) for m in markers}
    assert markers.short_skipped == 1


def test_shown_masks_every_marker_in_any_case():
    ms = [ph.Marker('email', TOY_EMAIL), ph.Marker('name', TOY_NAME), ph.Marker('user', TOY_USER)]
    text = f'TOY PERSON wrote to {TOY_EMAIL.upper()} from {win_profile(TOY_USER)}\\x'
    out = ph.shown(text, ms)
    assert_no_leak(out, TOY_NAME, TOY_EMAIL, TOY_USER)
    assert out == f'#2 (name, 10 chars) wrote to #1 (email, 23 chars) from {win_profile("#3 (user, 7 chars)")}\\x'


# --- the backup ----------------------------------------------------------------------------------------------------

def test_backup_copies_sources_hash_verified(tmp_path):
    toy = make_toy(tmp_path)
    data = (toy / 'sources' / 'notes.pdf').read_bytes()
    got = ph.backup_sources(toy, tmp_path / 'bk')
    assert got == {'notes.pdf': hashlib.sha256(data).hexdigest()}
    assert (tmp_path / 'bk' / 'notes.pdf').read_bytes() == data


def test_backup_refuses_a_dest_inside_the_repo_or_one_already_holding_files(tmp_path):
    toy = make_toy(tmp_path)
    with pytest.raises(ValueError):
        ph.backup_sources(toy, toy / 'bk')
    assert not (toy / 'bk').exists()
    full = tmp_path / 'full'
    full.mkdir()
    (full / 'old.txt').write_text('old\n', encoding='utf-8')
    with pytest.raises(ValueError):
        ph.backup_sources(toy, full)


def test_backup_of_a_repo_without_sources_copies_nothing(tmp_path):
    toy = make_toy(tmp_path)
    shutil.rmtree(toy / 'sources')
    assert ph.backup_sources(toy, tmp_path / 'bk') == {}


# --- a clean first publish -----------------------------------------------------------------------------------------

def test_a_clean_first_publish_is_one_noreply_commit_of_mains_tree(tmp_path, capsys):
    toy = make_toy(tmp_path)
    before = ph.state_of(toy)
    work, bk = tmp_path / 'work', tmp_path / 'bk'
    code, out = run(capsys, *publish_args(toy, work, bk))
    assert code == 0, ph.shown(out, ph.personal_markers(toy, set()))
    clone = work / 'clean'
    assert git(clone, 'rev-list', '--count', 'publish') == '1'
    snap = git(clone, 'rev-parse', 'publish')
    assert git(clone, 'rev-list', '--parents', '-n', '1', 'publish').split() == [snap]
    assert git(clone, 'rev-parse', 'publish^{tree}') == git(toy, 'rev-parse', 'main^{tree}')
    who = f'{GH} <{GH_EMAIL}>'
    assert git(clone, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'publish') == f'{who}|{who}'
    assert git(clone, 'log', '-1', '--format=%B', 'publish') == ph.SNAPSHOT_MESSAGE
    assert git(work / 'push.git', 'rev-parse', 'publish') == snap
    assert ph.state_of(toy) == before
    assert (toy / 'sources' / 'notes.pdf').exists()
    assert (toy / '.superpowers' / 'ledger.md').exists()
    assert (bk / 'notes.pdf').read_bytes() == (toy / 'sources' / 'notes.pdf').read_bytes()
    assert git(toy, 'config', 'user.name') == TOY_NAME
    assert git(clone, 'config', '--local', '--get', 'user.name', check=False) == ''
    assert snap in out
    assert 'clean/' in out and 'push.git/' in out
    assert_no_leak(out)


def test_a_repo_without_sources_still_publishes(tmp_path, capsys):
    toy = make_toy(tmp_path)
    shutil.rmtree(toy / 'sources')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 0
    assert 'no sources/' in out
    assert_no_leak(out)


# --- the push source: a fresh bare repo that holds only the snapshot -------------------------------------------------

def test_the_push_source_holds_only_the_snapshot_so_no_push_can_send_more(tmp_path, capsys):
    toy = make_toy(tmp_path)
    git(toy, 'tag', 'v-local')                                   # a tag into the local history
    work = tmp_path / 'work'
    code, out = run(capsys, *publish_args(toy, work, tmp_path / 'bk'))
    assert code == 0
    push = work / 'push.git'
    snap = git(work / 'clean', 'rev-parse', 'publish')
    assert git(push, 'rev-parse', '--is-bare-repository') == 'true'
    assert git(push, 'for-each-ref', '--format=%(refname) %(objectname)') == f'refs/heads/publish {snap}'
    assert git(push, 'symbolic-ref', 'HEAD') == 'refs/heads/publish'
    assert git(push, 'rev-list', '--all').split() == [snap]
    assert git(push, 'tag', '-l') == ''
    stored = set(git(push, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split())
    reachable = {line.split()[0] for line in git(push, 'rev-list', '--objects', '--all').splitlines()}
    assert stored == reachable, 'no object beyond the snapshot'
    assert git(push, 'config', '--get-regexp', 'remote', check=False) == ''
    for how in ('--all', '--mirror', '--tags'):
        target = bare(tmp_path / f'out{how}.git')
        git(push, 'push', '-q', how, str(target), check=how != '--tags')   # --tags: git says "doing nothing"
        assert git(target, 'rev-list', '--all').split() == ([] if how == '--tags' else [snap])
        assert git(target, 'tag', '-l') == ''
    clean = work / 'clean'                                       # the build clone keeps nothing else either
    assert git(clean, 'for-each-ref', '--format=%(refname)') == 'refs/heads/publish'
    assert git(clean, 'config', '--get-regexp', 'remote', check=False) == ''
    slip = subprocess.run(['git', '-C', str(clean), 'push', '-q', str(bare(tmp_path / 'slip.git')), 'main'],
                          capture_output=True)
    assert slip.returncode != 0, 'a one-token slip (main for publish:main) has nothing to push'
    assert_no_leak(out)


def test_verify_checks_that_the_push_source_holds_nothing_else(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH})
    before = ph.state_of(toy)
    clone = ph.make_clone(toy, tmp_path / 'work')
    snap = ph.build_snapshot(clone, GH, GH_EMAIL)
    push = ph.make_push_source(clone, tmp_path / 'work', snap)
    assert ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers, push=push).ok
    git(push, 'tag', 'extra', snap)
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers, push=push)
    assert not report.ok and any('push source' in p for p in report.problems)
    git(push, 'tag', '-d', 'extra')
    stray = subprocess.run(['git', '-C', str(push), 'hash-object', '-w', '--stdin'], input=b'stray\n',
                           capture_output=True, check=True)
    assert stray.returncode == 0
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers, push=push)
    assert not report.ok and any('push source' in p for p in report.problems)


# --- refusals ------------------------------------------------------------------------------------------------------

def dirty(toy: Path, kind: str) -> str:
    if kind == 'name':
        path = 'who.txt'
        (toy / path).write_text(f'Written by {TOY_NAME}.\n', encoding='utf-8')
    elif kind == 'email':
        path = 'contact.txt'
        (toy / path).write_text(f'line one\nMail {TOY_EMAIL} for the notes.\n', encoding='utf-8')
    elif kind == 'user':
        path = 'paths.md'
        (toy / path).write_text(f'The brief is in {win_profile(TOY_USER)}\\Downloads\\brief.pdf\n', encoding='utf-8')
    elif kind == 'big':
        path = 'big.bin'
        (toy / path).write_bytes(bytes(range(256)) * (6 * 1024 * 4))
    elif kind == 'ignored':
        path = '.superpowers/x.md'
        (toy / path).write_text('a ledger page\n', encoding='utf-8')
        git(toy, 'add', '-f', path)
    elif kind == 'sources':
        path = 'sources/a.pdf'
        (toy / path).write_bytes(b'%PDF-1.4 a\n')
        git(toy, 'add', '-f', path)
    git(toy, 'add', '-A')
    git(toy, 'commit', '-q', '-m', f'add {kind}')
    return path


@pytest.mark.parametrize('kind', ['name', 'email', 'user', 'big', 'ignored', 'sources'])
def test_the_scan_refuses_a_snapshot_with_a_hit_names_its_path_masked_and_leaves_nothing_to_push(
        tmp_path, capsys, kind):
    toy = make_toy(tmp_path)
    path = dirty(toy, kind)
    work = tmp_path / 'work'
    code, out = run(capsys, *publish_args(toy, work, tmp_path / 'bk'))
    assert code == 1
    assert path in out
    assert_no_leak(out)
    if kind in ('name', 'email', 'user'):
        line = 2 if kind == 'email' else 1
        assert re.search(re.escape(f'{path}:{line}') + r'.*' + MASKED.pattern.replace('email|name|user|extra', kind),
                         out)
    assert not (work / 'push.git').exists(), 'a refused snapshot never becomes push.git'
    assert sorted(p.name for p in work.iterdir()) == ['clean'], 'and its unscanned push source is removed'
    assert git(work / 'clean', 'for-each-ref', '--format=%(refname)') == ''
    assert 'nothing is left to push' in out


# --- the push source is named push.git only after a clean scan -------------------------------------------------------

@pytest.mark.parametrize('step', ['rev-parse', 'ls-tree'])
def test_a_git_failure_after_the_fetch_leaves_no_push_source(tmp_path, capsys, monkeypatch, step):
    """rev-parse fails inside make_push_source right after its fetch; ls-tree fails in verify's scan of it."""
    toy = make_toy(tmp_path)
    work = tmp_path / 'work'
    real_run = ph._run
    unscanned = getattr(ph, 'UNSCANNED_PREFIX', 'push.git')

    def failing_run(repo, *args, **kw):
        if Path(repo).name.startswith(unscanned) and args and args[0] == step:
            return subprocess.CompletedProcess(['git', *args], 128, b'', b'fatal: injected failure')
        return real_run(repo, *args, **kw)
    monkeypatch.setattr(ph, '_run', failing_run)
    code, out = run(capsys, *publish_args(toy, work, tmp_path / 'bk'))
    assert code == 1
    assert f'git {step} failed' in out and 'injected failure' in out
    assert 'nothing is left to push' in out
    assert not (work / 'push.git').exists()
    assert sorted(p.name for p in work.iterdir()) == ['clean'], 'no temporary push source is left'
    assert git(work / 'clean', 'for-each-ref', '--format=%(refname)') == ''
    assert_no_leak(out)


def test_an_existing_push_git_in_work_is_refused_before_anything_is_written(tmp_path, capsys):
    toy = make_toy(tmp_path)
    work = tmp_path / 'work'
    (work / 'push.git').mkdir(parents=True)
    code, out = run(capsys, *publish_args(toy, work, tmp_path / 'bk'))
    assert code == 1 and 'push.git' in out
    assert not (tmp_path / 'bk').exists() and not (work / 'clean').exists()


# --- the GitHub username is checked against every marker before anything is built ------------------------------------

@pytest.mark.parametrize('user, overlaps', [
    ('toyuser-dev', ['a local OS username, 7 chars']),
    ('personcodes', ['a local name word, 6 chars']),
    ('toy', ['a local email, 23 chars', 'a local email local part, 10 chars', 'a local name, 10 chars',
             'a local OS username, 7 chars']),
])
def test_a_github_user_that_overlaps_a_marker_is_refused_before_anything_is_built(tmp_path, capsys, user,
                                                                                  overlaps):
    toy = make_toy(tmp_path)
    code, out = run(capsys, '--github-user', user, '--work', str(tmp_path / 'work'), '--backup',
                    str(tmp_path / 'bk'), '--repo', str(toy))
    assert code == 1
    assert 'your GitHub username (--github-user) overlaps' in out and 'Decide with the user' in out
    for overlap in overlaps:
        assert overlap in out
    assert not (tmp_path / 'work').exists() and not (tmp_path / 'bk').exists(), 'nothing is built'
    assert_no_leak(out)
    assert 'toyuser-dev' not in out and 'personcodes' not in out


def test_a_marker_inside_the_noreply_address_is_an_overlap_too(tmp_path, capsys):
    toy = make_toy(tmp_path)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk', '--extra-marker', 'github'))
    assert code == 1
    assert 'overlaps' in out and 'a local extra marker, 6 chars' in out
    assert not (tmp_path / 'work').exists()


# --- --allow-github-user-overlap: the user's own choice when their GitHub username holds their name ------------------

# Made up, like every value here. The name's only word of 4 letters or more is "Jane", and the GitHub username holds
# it; the full name, the email, its local part and the OS username overlap nothing in the username.
OV_NAME = 'Jane Doe'
OV_WORD = 'Jane'
OV_EMAIL = 'jane.doe@example.test'
OV_LOCAL = 'jane.doe'
OV_OS = 'jdoe'
OV_GH = 'JaneDoe'
OV_NOREPLY = 'JaneDoe@users.noreply.github.com'
OV_LEAKS = (OV_NAME, OV_WORD, OV_EMAIL, OV_LOCAL, OV_OS, OV_GH)
SWITCH = '--allow-github-user-overlap'


@pytest.fixture
def ov_toy(tmp_path, monkeypatch) -> Path:
    """A toy repo whose every commit is by the made-up name and email, on a machine with the made-up OS username."""
    monkeypatch.setattr(ph, 'os_username', lambda: OV_OS)
    return make_toy(tmp_path, who=OV_NAME, email=OV_EMAIL)


def ov_args(toy, work, backup, *extra):
    return ['--github-user', OV_GH, '--work', str(work), '--backup', str(backup), '--repo', str(toy), *extra]


def notice_line(out: str) -> str:
    return next(line for line in out.splitlines() if line.startswith('notice:'))


def commit_as(repo: Path, parent: str, name: str, email: str, message: str) -> str:
    """A commit on parent, with parent's tree, authored and committed as name <email>."""
    env = {**os.environ, 'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name,
           'GIT_COMMITTER_EMAIL': email}
    r = subprocess.run(['git', '-C', str(repo), 'commit-tree', f'{parent}^{{tree}}', '-p', parent, '-m', message],
                       capture_output=True, text=True, env=env, check=True)
    return r.stdout.strip()


def test_without_the_switch_a_username_that_holds_the_name_is_refused_as_before(tmp_path, capsys, ov_toy):
    code, out = run(capsys, *ov_args(ov_toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1
    assert 'your GitHub username (--github-user) overlaps' in out and 'Decide with the user' in out
    assert 'a local name word, 4 chars' in out
    assert SWITCH in out and 'notice:' not in out, 'the refusal names the switch as the user\'s choice, never takes it'
    assert not (tmp_path / 'work').exists() and not (tmp_path / 'bk').exists(), 'nothing is built'
    assert_no_leak(out, *OV_LEAKS)


@pytest.mark.parametrize('github_id', [None, '123'])
def test_with_the_switch_a_clean_tree_publishes_under_the_username_and_its_noreply_address(tmp_path, capsys, ov_toy,
                                                                                          github_id):
    before = ph.state_of(ov_toy)
    work = tmp_path / 'work'
    code, out = run(capsys, *ov_args(ov_toy, work, tmp_path / 'bk', SWITCH,
                                     *(['--github-id', github_id] if github_id else [])))
    assert code == 0, ph.shown(out, ph.personal_markers(ov_toy, set()))
    assert 'result: OK' in out
    push = work / 'push.git'
    who = f'{OV_GH} <{"123+" if github_id else ""}{OV_NOREPLY}>'
    assert git(push, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', 'publish') == f'{who}|{who}'
    assert git(push, 'log', '-1', '--format=%B', 'publish') == ph.SNAPSHOT_MESSAGE
    assert git(push, 'rev-list', '--all').split() == [git(push, 'rev-parse', 'publish')]
    assert git(push, 'rev-parse', 'publish^{tree}') == git(ov_toy, 'rev-parse', 'main^{tree}')
    assert ph.state_of(ov_toy) == before
    notice = notice_line(out)
    assert 'The user accepted this (--allow-github-user-overlap)' in notice and '1 value(s)' in notice
    assert 'a local name word, 4 chars' in notice
    for other in ('a local name,', 'a local email', 'a local OS username'):
        assert other not in notice, 'only the values the username overlaps are accepted'
    assert re.search(r'author and committer: #\d+ \(github, 7 chars\), with its noreply address', out)
    assert_no_leak(out, *OV_LEAKS)


OV_TREE_HITS = {
    'the full name': ('Written by Jane Doe.\n', 'name'),
    'the name word': ('Signed: Jane\n', 'name'),
    'the username': ('Built by JaneDoe\n', 'github'),
    'the username in lower case': ('built by janedoe\n', 'github'),
    'the noreply address': (f'Mail {OV_NOREPLY}\n', 'github'),
    'the email': (f'Mail {OV_EMAIL} for the notes.\n', 'email'),
    'the email local part': (f'handle {OV_LOCAL}\n', 'email'),
    'the OS username': (f'saved as {OV_OS}_backup\n', 'user'),
    'a profile path': (f'see {win_profile("someoneelse")}\\notes.txt\n', None),
}


@pytest.mark.parametrize('what', list(OV_TREE_HITS))
def test_with_the_switch_the_tree_is_still_refused_on_each_value(tmp_path, capsys, ov_toy, what):
    content, kind = OV_TREE_HITS[what]
    add_file(ov_toy, 'notes/hit.md', content)
    work = tmp_path / 'work'
    code, out = run(capsys, *ov_args(ov_toy, work, tmp_path / 'bk', SWITCH))
    assert code == 1
    hit = (rf'notes/hit\.md:1: marker #\d+ \({kind}, \d+ chars\)' if kind else
           r'notes/hit\.md:1: an absolute profile path')
    assert re.search(hit, out), what
    assert 'result: REFUSED' in out and 'nothing is left to push' in out
    assert not (work / 'push.git').exists()
    assert_no_leak(out, *OV_LEAKS)
    code, out = run(capsys, '--scan-only', '--repo', str(ov_toy), '--github-user', OV_GH, SWITCH)
    assert code == 1 and re.search(hit, out), what
    assert_no_leak(out, *OV_LEAKS)


def test_with_the_switch_no_waiver_skips_the_username(tmp_path, capsys, ov_toy):
    add_file(ov_toy, 'docs/fixture.md', 'a made-up author: JaneDoe\n')
    code, out = run(capsys, '--scan-only', '--repo', str(ov_toy), '--github-user', OV_GH, SWITCH,
                    '--allow-file', 'docs/fixture.md')
    assert code == 1
    assert re.search(r'  - docs/fixture\.md:1: marker #\d+ \(github, 7 chars\)', out)
    assert 'result: REFUSED' in out
    assert_no_leak(out, *OV_LEAKS)


def test_with_the_switch_a_commit_message_that_holds_the_name_is_refused(tmp_path, capsys, ov_toy, monkeypatch):
    monkeypatch.setattr(ph, 'SNAPSHOT_MESSAGE', 'Publish the notes of Jane Doe')
    work = tmp_path / 'work'
    code, out = run(capsys, *ov_args(ov_toy, work, tmp_path / 'bk', SWITCH))
    assert code == 1
    assert re.search(r'commit [0-9a-f]{12}: marker #\d+ \(name, 8 chars\) in its message', out)
    assert 'result: REFUSED' in out and 'nothing is left to push' in out
    assert not (work / 'push.git').exists()
    assert_no_leak(out, *OV_LEAKS)


@pytest.mark.parametrize('name, email, message, where', [
    (OV_GH, OV_NOREPLY, 'Publish the notes of Jane', 'its message'),
    (OV_NAME, OV_NOREPLY, 'Publish', 'its author'),            # the full name as the author
    (OV_GH, OV_EMAIL, 'Publish', 'its committer'),             # the real email
])
def test_with_the_switch_a_published_parent_is_scanned_as_strictly(tmp_path, capsys, ov_toy, name, email, message,
                                                                   where):
    remote = bare(tmp_path / 'remote.git')
    assert run(capsys, *ov_args(ov_toy, tmp_path / 'w1', tmp_path / 'b1', SWITCH))[0] == 0
    git(tmp_path / 'w1' / 'push.git', 'push', '-q', str(remote), 'publish:main')
    parent = commit_as(remote, git(remote, 'rev-parse', 'main'), name, email, message)
    git(remote, 'update-ref', 'refs/heads/main', parent)
    work = tmp_path / 'w2'
    code, out = run(capsys, *ov_args(ov_toy, work, tmp_path / 'b2', SWITCH, '--parent', parent, '--remote',
                                     str(remote)))
    assert code == 1
    assert re.search(rf'commit {parent[:12]}: marker #\d+ \(\w+, \d+ chars\) in {where}', out)
    assert not (work / 'push.git').exists()
    assert_no_leak(out, *OV_LEAKS)


def test_with_the_switch_only_the_exact_username_and_noreply_address_stand_in_a_commit(tmp_path, ov_toy):
    markers = ph.personal_markers(ov_toy, {OV_GH})
    markers.append(ph.github_user_marker(OV_GH))
    identity = (OV_GH, OV_NOREPLY)
    tree = git(ov_toy, 'rev-parse', 'main^{tree}')

    def commit(author=(OV_GH, OV_NOREPLY), committer=(OV_GH, OV_NOREPLY), header='', message='Publish'):
        body = (f'tree {tree}\nauthor {author[0]} <{author[1]}> 1700000000 +0800\n'
                f'committer {committer[0]} <{committer[1]}> 1700000000 +0800\n{header}\n{message}\n')
        r = subprocess.run(['git', '-C', str(ov_toy), 'hash-object', '-t', 'commit', '-w', '--stdin'],
                           input=body.encode(), capture_output=True, check=True)       # bytes: no CRLF on Windows
        return r.stdout.decode().strip()

    exact = commit()
    assert ph.scan_commits(ov_toy, exact, markers, identity) == []
    assert ph.scan_commits(ov_toy, exact, markers), 'without the identity (no switch) the same commit is refused'
    for change, where in [
        (dict(author=(OV_NAME, OV_NOREPLY)), 'its author'),                  # the full name
        (dict(committer=(OV_GH, OV_EMAIL)), 'its committer'),                # the real email
        (dict(author=('janedoe', OV_NOREPLY)), 'its author'),                # not exactly the username
        (dict(committer=(OV_GH, '123+' + OV_NOREPLY)), 'its committer'),     # not exactly its noreply address
        (dict(author=(OV_OS, OV_NOREPLY)), 'its author'),                    # the OS username
        (dict(header='encoding Jane\n'), 'another of its header lines'),     # any other field
        (dict(message='Publish, by Jane Doe'), 'its message'),
    ]:
        hits = ph.scan_commits(ov_toy, commit(**change), markers, identity)
        assert any(h.endswith(f' in {where}') for h in hits), change
        assert_no_leak('\n'.join(hits), *OV_LEAKS)


def test_the_switch_never_waives_a_marker_that_does_not_overlap_the_username(tmp_path, capsys, ov_toy):
    add_file(ov_toy, 'owner.md', 'Owner: Quillon\n')
    code, out = run(capsys, *ov_args(ov_toy, tmp_path / 'w1', tmp_path / 'b1', SWITCH, '--extra-marker', 'Quillon'))
    assert code == 1
    assert re.search(r'owner\.md:1: marker #\d+ \(extra, 7 chars\)', out)
    assert 'extra marker' not in notice_line(out)
    assert_no_leak(out, *OV_LEAKS, 'Quillon')
    # a value only the noreply address holds (here its id), not the username, is refused before anything is built
    code, out = run(capsys, *ov_args(ov_toy, tmp_path / 'w2', tmp_path / 'b2', SWITCH, '--github-id', '424242',
                                     '--extra-marker', '424242'))
    assert code == 1
    assert 'overlap the noreply address but not the GitHub username itself' in out
    assert 'a local extra marker, 6 chars' in out and 'notice:' not in out
    assert not (tmp_path / 'w2').exists() and not (tmp_path / 'b2').exists()
    assert_no_leak(out, *OV_LEAKS, '424242')


def test_with_the_switch_a_local_value_equal_to_the_username_stands_only_as_the_author(tmp_path, capsys, ov_toy,
                                                                                      monkeypatch):
    monkeypatch.setattr(ph, 'os_username', lambda: OV_GH)
    code, out = run(capsys, *ov_args(ov_toy, tmp_path / 'w1', tmp_path / 'b1', SWITCH))
    assert code == 0 and 'a local OS username, 7 chars' in notice_line(out)
    assert_no_leak(out, *OV_LEAKS)
    add_file(ov_toy, 'notes/hit.md', 'by janedoe\n')
    code, out = run(capsys, *ov_args(ov_toy, tmp_path / 'w2', tmp_path / 'b2', SWITCH))
    assert code == 1 and re.search(r'notes/hit\.md:1: marker #\d+ \(github, 7 chars\)', out)
    assert_no_leak(out, *OV_LEAKS)


def test_with_the_switch_and_no_overlap_the_username_is_still_a_marker(tmp_path, capsys):
    toy = make_toy(tmp_path)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w1', tmp_path / 'b1', SWITCH))
    assert code == 0 and 'overlaps no value read on this machine' in notice_line(out)
    add_file(toy, 'notes/hit.md', f'pushed by {GH}\n')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w2', tmp_path / 'b2', SWITCH))
    assert code == 1 and re.search(r'notes/hit\.md:1: marker #\d+ \(github, 12 chars\)', out)
    assert run(capsys, *publish_args(toy, tmp_path / 'w3', tmp_path / 'b3'))[0] == 0, 'without it, no marker as before'
    assert_no_leak(out)


def test_the_switch_needs_a_github_user(tmp_path, capsys, ov_toy):
    code, out = run(capsys, '--scan-only', '--repo', str(ov_toy), SWITCH)
    assert code == 1 and 'refused: --allow-github-user-overlap needs --github-user' in out
    assert_no_leak(out, *OV_LEAKS)


# --- the matching: every form of a marker, and any profile path ------------------------------------------------------

ESCAPES = {
    'the email local part alone': (f'handle: {TOY_LOCAL}\n', 'email'),
    'the name over a line break': ('Toy\nPerson wrote it\n', 'name'),
    'the name with two spaces': ('Toy  Person wrote it\n', 'name'),
    'the first word of a name alone': ('signed: Mock\n', 'name'),
    'the user in a URL-encoded profile path': (urllib.parse.quote(win_profile(TOY_USER) + '\\notes', safe='') + '\n',
                                               'user'),
    'the user then an underscore': (f'saved as {TOY_USER}_backup\n', 'user'),
    'a mixed-case name': ('by tOY pERSON\n', 'name'),
    'the user in an MSYS profile path': (msys_profile(TOY_USER) + '/notes\n', 'user'),
    'the name joined by a plus': ('q=Toy+Person\n', 'name'),
}


@pytest.mark.parametrize('form', list(ESCAPES))
def test_each_form_of_a_marker_the_review_found_is_caught(tmp_path, capsys, form):
    content, kind = ESCAPES[form]
    toy = make_toy(tmp_path)
    git(toy, '-c', 'user.name=Mock Tester', '-c', 'user.email=mock.tester@example.test', 'commit', '-q',
        '--allow-empty', '-m', 'a second toy author')
    add_file(toy, 'notes/hit.md', content)
    code, out = run(capsys, '--scan-only', '--repo', str(toy))
    assert code == 1
    assert re.search(re.escape('notes/hit.md:1: marker ') + MASKED.pattern.replace('email|name|user|extra', kind),
                     out), form
    assert_no_leak(out, *LEAKS, 'Mock Tester', 'mock.tester', 'Tester')


@pytest.mark.parametrize('text', ['Toy\nPerson', 'Toy  Person', 'Toy\r\n\tPerson', 'toy%20person', 'Toy+Person',
                                  'TOY PERSON', 'Toy%0APerson'])
def test_a_name_matches_across_whitespace_case_and_url_encoding_on_the_line_it_starts(tmp_path, text):
    toy = make_toy(tmp_path)
    add_file(toy, 'f.md', f'line one\n{text} wrote this\nline three\n')
    hits = ph.scan_tree(toy, 'main^{tree}', [ph.Marker('name', TOY_NAME)], [])
    assert hits == ['f.md:2: marker #1 (name, 10 chars)']


@pytest.mark.parametrize('form', ['windows', 'windows forward', 'msys', 'macos', 'home', 'url-encoded'])
def test_any_absolute_profile_path_is_refused_whatever_the_user(tmp_path, form):
    who = 'someoneelse'
    path = {'windows': win_profile(who), 'windows forward': win_profile(who, '/'), 'msys': msys_profile(who),
            'macos': mac_profile(who), 'home': home_profile(who),
            'url-encoded': urllib.parse.quote(win_profile(who), safe='')}[form]
    toy = make_toy(tmp_path)
    add_file(toy, 'p.md', f'first line\nsee {path}/notes.txt\n')
    assert ph.scan_tree(toy, 'main^{tree}', [], []) == ['p.md:2: an absolute profile path (its user folder is 11 chars)']


def test_paths_that_only_look_like_profile_paths_pass(tmp_path):
    toy = make_toy(tmp_path)
    add_file(toy, 'ok.md', 'https://api.example.test/users/someone/repos\ndocs/home/page.md\nC:\\Program Files\\x\n'
                           'the Users folder\n')
    assert ph.scan_tree(toy, 'main^{tree}', [], []) == []


def test_a_hit_in_a_path_name_is_masked(tmp_path):
    toy = make_toy(tmp_path)
    add_file(toy, f'docs/{TOY_LOCAL}-notes.md', 'notes\n')
    hits = ph.scan_tree(toy, 'main^{tree}', ph.personal_markers(toy, {GH}), [])
    assert any(re.fullmatch(r'docs/#\d+ \(email, 10 chars\)-notes\.md: marker #\d+ \(email, 10 chars\) in the path', h)
               for h in hits)
    assert_no_leak('\n'.join(hits))


def test_extra_marker_finds_a_value_no_runtime_source_holds(tmp_path, capsys):
    toy = make_toy(tmp_path)
    add_file(toy, 'owner.md', 'Owner: Quillon, the trainee\n')
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 0
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--extra-marker', 'Quillon')
    assert code == 1
    assert re.search(r'owner\.md:1: marker #\d+ \(extra, 7 chars\)', out)
    assert_no_leak(out, *LEAKS, 'Quillon')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk', '--extra-marker', 'Quillon'))
    assert code == 1
    assert_no_leak(out, *LEAKS, 'Quillon')


def test_allow_file_waives_only_the_hits_in_the_files_it_names(tmp_path, capsys):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/fixture.md', f'a made-up path: {home_profile("someoneelse")}/x\n')
    add_file(toy, 'docs/other.md', f'another: {win_profile("another")}\\x\n')
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 1
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md')
    assert code == 1 and 'docs/other.md:1' in out and 'waived' in out
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md',
                    '--allow-file', 'docs/other.md')
    assert code == 0
    assert 'docs/fixture.md:1' in out and 'docs/other.md:1' in out and out.count('waived') >= 2
    path = dirty(toy, 'sources')
    assert run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', path)[0] == 1, 'no waiver for sources/'


# --- final review, parked item 2: N2 (waivers), N4 (--backup inside --work), N6 (--extra-marker-file) ------------------

@pytest.mark.parametrize('kind, content', [
    ('email', f'Mail {TOY_EMAIL} for the notes.\n'),
    ('name', f'Written by {TOY_NAME}.\n'),
    ('user', f'Signed {TOY_USER}.\n'),
])
def test_a_waiver_never_skips_a_full_email_name_or_user_marker(tmp_path, capsys, kind, content):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/fixture.md', content)
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md')
    assert code == 1, 'refused, waiver or not'
    assert re.search(re.escape('docs/fixture.md:1: marker ') + MASKED.pattern.replace('email|name|user|extra', kind), out)
    assert 'result: REFUSED' in out
    assert_no_leak(out)


def test_a_waiver_never_skips_an_extra_marker(tmp_path, capsys):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/fixture.md', 'Owner: Quillon\n')
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md', '--extra-marker', 'Quillon')
    assert code == 1
    assert re.search(r'docs/fixture\.md:1: marker #\d+ \(extra, 7 chars\)', out)
    assert_no_leak(out, *LEAKS, 'Quillon')


def test_a_waiver_still_waives_a_part_of_a_value_or_a_profile_path(tmp_path, capsys):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/fixture.md', f'a made-up word: {TOY_WORD}\nhandle {TOY_LOCAL}x\npath {home_profile("someoneelse")}/x\n')
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 1
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md')
    assert code == 0
    for line in (1, 2, 3):
        assert f'waived (--allow-file): docs/fixture.md:{line}: ' in out
    assert_no_leak(out)


def test_a_waiver_that_matches_nothing_is_warned_about(tmp_path, capsys):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/fixture.md', f'path {home_profile("someoneelse")}/x\n')
    add_file(toy, 'docs/clean.md', 'nothing to see here\n')
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--allow-file', 'docs/fixture.md',
                    '--allow-file', 'docs/clean.md', '--allow-file', 'docs/gone.md')
    assert code == 0
    assert 'warning: --allow-file docs/clean.md waives nothing' in out
    assert 'warning: --allow-file docs/gone.md waives nothing' in out
    assert 'warning: --allow-file docs/fixture.md' not in out
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk', '--allow-file', 'docs/fixture.md',
                                          '--allow-file', 'docs/clean.md'))
    assert code == 0 and 'result: OK' in out
    assert 'warning: --allow-file docs/clean.md waives nothing' in out


@pytest.mark.parametrize('where', ['backup inside work', 'work inside backup', 'the same folder'])
def test_backup_inside_work_is_refused_before_anything_is_written(tmp_path, capsys, where):
    toy = make_toy(tmp_path)
    work, backup = {'backup inside work': (tmp_path / 'work', tmp_path / 'work' / 'bk'),
                    'work inside backup': (tmp_path / 'bk' / 'work', tmp_path / 'bk'),
                    'the same folder': (tmp_path / 'both', tmp_path / 'both')}[where]
    code, out = run(capsys, *publish_args(toy, work, backup))
    assert code == 1
    assert 'refused: --backup and --work must be apart' in out
    assert not work.exists() and not backup.exists(), 'nothing is written'


def write_marker_file(path: Path, *values: str, bom=False, crlf=False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    nl ='\r\n' if crlf else '\n'
    path.write_text(('﻿' if bom else '') + nl.join(values) + nl, encoding='utf-8', newline='')
    return path


@pytest.mark.parametrize('bom, crlf', [(False, False), (True, True)])
def test_extra_marker_file_reads_one_marker_a_line_at_runtime_and_never_prints_one(tmp_path, capsys, bom, crlf):
    toy = make_toy(tmp_path)
    add_file(toy, 'owner.md', 'Owner: Quillon, the trainee\nReviewed by Bramwell Okonkwo\n')
    markers = write_marker_file(tmp_path / 'outside' / 'markers.txt', 'Quillon', '', '  Bramwell Okonkwo  ', bom=bom, crlf=crlf)
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 0
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--extra-marker-file', str(markers))
    assert code == 1
    assert re.search(r'owner\.md:1: marker #\d+ \(extra, 7 chars\)', out)
    assert re.search(r'owner\.md:2: marker #\d+ \(extra, 16 chars\)', out)
    assert_no_leak(out, *LEAKS, 'Quillon', 'Bramwell', 'Okonkwo')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk', '--extra-marker-file', str(markers)))
    assert code == 1 and 'owner.md' in out
    assert_no_leak(out, *LEAKS, 'Quillon', 'Bramwell', 'Okonkwo')


def test_extra_marker_file_inside_the_repo_is_refused_and_never_read(tmp_path, capsys):
    toy = make_toy(tmp_path)
    inside = write_marker_file(toy / '.superpowers' / 'markers.txt', 'Quillon')
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--extra-marker-file', str(inside))
    assert code == 1
    assert 'refused: --extra-marker-file must be outside the repo' in out
    assert_no_leak(out, *LEAKS, 'Quillon', 'markers.txt')


def test_extra_marker_file_that_cannot_be_read_is_refused_without_echoing_it(tmp_path, capsys):
    toy = make_toy(tmp_path)
    missing = tmp_path / 'outside' / 'Quillon-markers.txt'
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--extra-marker-file', str(missing))
    assert code == 1 and 'refused: --extra-marker-file could not be read' in out
    assert_no_leak(out, *LEAKS, 'Quillon')
    binary = tmp_path / 'binary.txt'
    binary.write_bytes(b'Quillon\xff\xfe\n')
    code, out = run(capsys, '--scan-only', '--repo', str(toy), '--extra-marker-file', str(binary))
    assert code == 1 and 'refused: --extra-marker-file could not be read' in out
    assert_no_leak(out, *LEAKS, 'Quillon')


# --- ignored paths: every ignore source git reads ----------------------------------------------------------------

def test_a_folder_only_info_exclude_names_is_refused(tmp_path, capsys):
    toy = make_toy(tmp_path)
    with (toy / '.git' / 'info' / 'exclude').open('a', encoding='utf-8') as f:
        f.write('.claude/\n')
    add_file(toy, '.claude/settings.local.json', '{}\n', force=True)
    code, out = run(capsys, '--scan-only', '--repo', str(toy))
    assert code == 1 and '.claude/settings.local.json' in out
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1 and '.claude/settings.local.json' in out


def test_a_folder_only_the_global_excludes_file_names_is_refused(tmp_path, capsys):
    toy = make_toy(tmp_path)
    excludes = Path(os.environ['HOME']) / 'toy-excludes'
    excludes.write_text('private-notes/\n', encoding='utf-8')
    global_config().write_text(GLOBAL_CONFIG + f'[core]\n\texcludesFile = {excludes.as_posix()}\n', encoding='utf-8')
    add_file(toy, 'private-notes/a.md', 'notes\n', force=True)
    code, out = run(capsys, '--scan-only', '--repo', str(toy))
    assert code == 1 and 'private-notes/a.md' in out


# --- compressed and UTF-16 text --------------------------------------------------------------------------------------

def png(*chunks: tuple[bytes, bytes]) -> bytes:
    out = b'\x89PNG\r\n\x1a\n'
    for kind, body in [*chunks, (b'IEND', b'')]:
        out += len(body).to_bytes(4, 'big') + kind + body + zlib.crc32(kind + body).to_bytes(4, 'big')
    return out


def test_png_text_chunks_are_read_even_when_compressed(tmp_path):
    toy = make_toy(tmp_path)
    add_file(toy, 'z.png', png((b'zTXt', b'Author\0\0' + zlib.compress(TOY_NAME.encode()))))
    add_file(toy, 'i.png', png((b'iTXt', b'Author\0\1\0en\0\0' + zlib.compress(TOY_USER.encode()))))
    add_file(toy, 't.png', png((b'tEXt', b'Author\0' + TOY_EMAIL.encode())))
    markers = [ph.Marker('email', TOY_EMAIL), ph.Marker('name', TOY_NAME), ph.Marker('user', TOY_USER)]
    hits = ph.scan_tree(toy, 'main^{tree}', markers, [])
    assert 'z.png: marker #2 (name, 10 chars) in a PNG zTXt chunk' in hits
    assert 'i.png: marker #3 (user, 7 chars) in a PNG iTXt chunk' in hits
    assert any(h.startswith('t.png') and '#1 (email, 23 chars)' in h for h in hits)
    assert_no_leak('\n'.join(hits))


@pytest.mark.parametrize('codec', ['utf-16-le', 'utf-16-be'])
def test_utf16_text_in_a_binary_blob_is_found_at_its_very_end(tmp_path, codec):
    toy = make_toy(tmp_path)
    add_file(toy, 'meta.bin', b'\0\0\x01\x02' + TOY_USER.encode(codec))
    hits = ph.scan_tree(toy, 'main^{tree}', [ph.Marker('user', TOY_USER)], [])
    assert any(h.startswith('meta.bin') and '#1 (user, 7 chars) (binary)' in h for h in hits)


def test_a_compressed_container_is_refused_since_its_inside_cannot_be_read(tmp_path):
    toy = make_toy(tmp_path)
    add_file(toy, 'docs/handout.pdf', b'%PDF-1.7\n')
    add_file(toy, 'docs/table.xlsx', b'PK\x03\x04')
    hits = ph.scan_tree(toy, 'main^{tree}', [], [])
    assert "docs/handout.pdf: a compressed .pdf file the scan can't read inside" in hits
    assert "docs/table.xlsx: a compressed .xlsx file the scan can't read inside" in hits


# --- stacked publishing --------------------------------------------------------------------------------------------

def test_later_publishes_stack_on_the_published_commit(tmp_path, capsys):
    toy = make_toy(tmp_path)
    remote = bare(tmp_path / 'remote.git')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w1', tmp_path / 'b1'))
    assert code == 0
    first = git(tmp_path / 'w1' / 'push.git', 'rev-parse', 'publish')
    git(tmp_path / 'w1' / 'push.git', 'push', '-q', str(remote), 'publish:main')

    (toy / 'app.txt').write_text('version three\n', encoding='utf-8')
    git(toy, 'commit', '-q', '-am', 'edit the app again')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w2', tmp_path / 'b2', '--parent', first,
                                          '--remote', str(remote)))
    assert code == 0
    push2 = tmp_path / 'w2' / 'push.git'
    second = git(push2, 'rev-parse', 'publish')
    assert git(push2, 'rev-list', '--parents', '-n', '1', second).split() == [second, first]
    assert git(push2, 'rev-list', '--all').split() == [second, first], 'the snapshot and its published parent only'
    assert git(push2, 'rev-parse', 'publish^{tree}') == git(toy, 'rev-parse', 'main^{tree}')
    git(push2, 'push', '-q', str(remote), 'publish:main')       # a fast-forward: a rewrite would be refused
    assert git(remote, 'rev-list', '--count', 'main') == '2'
    assert_no_leak(out)


def test_a_parent_the_remotes_main_does_not_have_is_refused(tmp_path, capsys):
    toy = make_toy(tmp_path)
    remote = bare(tmp_path / 'remote.git')
    assert run(capsys, *publish_args(toy, tmp_path / 'w1', tmp_path / 'b1'))[0] == 0
    git(tmp_path / 'w1' / 'push.git', 'push', '-q', str(remote), 'publish:main')
    wrong = git(toy, 'rev-parse', 'main')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w2', tmp_path / 'b2', '--parent', wrong,
                                          '--remote', str(remote)))
    assert code == 1
    assert "--parent is not the remote's main" in out
    assert git(tmp_path / 'w2' / 'clean', 'rev-parse', '--verify', '-q', 'publish', check=False) == ''
    assert not (tmp_path / 'w2' / 'push.git').exists()
    assert_no_leak(out)


def test_a_parent_without_a_remote_is_refused(tmp_path, capsys):
    toy = make_toy(tmp_path)
    head = git(toy, 'rev-parse', 'main')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w', tmp_path / 'b', '--parent', head))
    assert code == 1
    assert not (tmp_path / 'b').exists(), 'it refused before writing anything'
    clone = ph.make_clone(toy, tmp_path / 'w2')
    with pytest.raises(ValueError):
        ph.build_snapshot(clone, GH, GH_EMAIL, parent=head)
    assert_no_leak(out)


def test_a_remote_without_a_parent_is_refused(tmp_path, capsys):
    toy = make_toy(tmp_path)
    remote = bare(tmp_path / 'remote.git')
    assert run(capsys, *publish_args(toy, tmp_path / 'w1', tmp_path / 'b1'))[0] == 0
    git(tmp_path / 'w1' / 'push.git', 'push', '-q', str(remote), 'publish:main')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'w', tmp_path / 'b', '--remote', str(remote)))
    assert code == 1
    assert '--parent and --remote go together' in out
    assert not (tmp_path / 'b').exists(), 'it refused before writing anything'
    clone = ph.make_clone(toy, tmp_path / 'w2')
    with pytest.raises(ph.Refused, match='the remote already has a main'):
        ph.build_snapshot(clone, GH, GH_EMAIL, remote=str(remote))
    assert git(clone, 'rev-parse', '--verify', '-q', 'publish', check=False) == ''
    assert_no_leak(out)


# --- commit signing: never skipped, never done; a signing config stops the publish for the user to decide ----------

NO_GPG = 'no-such-gpg-program'      # a signing program that doesn't exist: no real key is ever touched


def set_to_sign(repo: Path):
    git(repo, 'config', 'commit.gpgsign', 'true')
    git(repo, 'config', 'gpg.program', NO_GPG)
    git(repo, 'config', 'user.signingkey', 'TOYKEY0000')


def test_a_repo_set_to_sign_stops_the_publish_before_anything_is_written(tmp_path, capsys):
    toy = make_toy(tmp_path)
    set_to_sign(toy)
    before = ph.state_of(toy)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1
    assert ph.SIGNING_REFUSAL in out
    assert ph.state_of(toy) == before
    assert not (tmp_path / 'bk').exists() and not (tmp_path / 'work' / 'clean').exists()
    assert_no_leak(out)


def test_a_machine_set_to_sign_stops_the_publish_and_build_snapshot_refuses(tmp_path, capsys):
    toy = make_toy(tmp_path)
    clone = ph.make_clone(toy, tmp_path / 'early')
    global_config().write_text(GLOBAL_CONFIG + f'[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = {NO_GPG}\n'
                               '[user]\n\tsigningkey = TOYKEY0000\n', encoding='utf-8')
    git(toy, 'config', '--unset', 'commit.gpgsign')    # the toy's own "false" would hide the global setting
    before = ph.state_of(toy)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1
    assert ph.SIGNING_REFUSAL in out
    assert ph.state_of(toy) == before
    with pytest.raises(ph.Refused) as refused:
        ph.build_snapshot(clone, GH, GH_EMAIL)
    assert str(refused.value) == ph.SIGNING_REFUSAL
    assert git(clone, 'rev-parse', '--verify', '-q', 'publish', check=False) == ''
    assert_no_leak(out)


def test_a_git_error_while_signing_is_the_same_refusal(tmp_path, monkeypatch):
    toy = make_toy(tmp_path)
    clone = ph.make_clone(toy, tmp_path / 'work')
    git(clone, 'config', 'gpg.program', NO_GPG)
    git(clone, 'config', 'user.signingkey', 'TOYKEY0000')
    # A git that signs without the config saying so: commit-tree gets -S, and the missing program makes it fail.
    monkeypatch.setattr(ph, 'signing_configured', lambda repo: False)
    real_gits = ph._gits

    def signing_gits(repo, *args, **kw):
        if args and args[0] == 'commit-tree':
            args = ('commit-tree', '-S', *args[1:])
        return real_gits(repo, *args, **kw)
    monkeypatch.setattr(ph, '_gits', signing_gits)
    with pytest.raises(ph.Refused) as refused:
        ph.build_snapshot(clone, GH, GH_EMAIL)
    assert str(refused.value) == ph.SIGNING_REFUSAL
    assert git(clone, 'rev-parse', '--verify', '-q', 'publish', check=False) == ''


def test_the_default_config_builds_an_unsigned_snapshot(tmp_path, capsys):
    toy = make_toy(tmp_path)
    assert ph.signing_configured(toy) is False
    git(toy, 'config', '--unset', 'commit.gpgsign')
    assert ph.signing_configured(toy) is False
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 0
    raw = git(tmp_path / 'work' / 'push.git', 'cat-file', 'commit', 'publish')
    assert 'gpgsig' not in raw
    git(toy, 'config', 'commit.gpgsign', 'maybe')       # a value git can't read as yes or no counts as set
    assert ph.signing_configured(toy) is True


# --- the docs scrub's finder ---------------------------------------------------------------------------------------

def test_scan_only_finds_a_hit_then_passes_once_it_is_removed_in_a_commit(tmp_path, capsys):
    toy = make_toy(tmp_path)
    dirty(toy, 'user')
    before = ph.state_of(toy)
    code, out = run(capsys, '--scan-only', '--repo', str(toy))
    assert code == 1
    assert 'paths.md:1' in out
    assert_no_leak(out)
    assert ph.state_of(toy) == before, 'the scan is read-only'
    (toy / 'paths.md').write_text('The brief is the PDF in Downloads.\n', encoding='utf-8')
    git(toy, 'commit', '-q', '-am', 'docs: no profile path')
    code, out = run(capsys, '--scan-only', '--repo', str(toy))
    assert code == 0
    assert_no_leak(out)


def test_scan_only_reads_the_committed_tree_not_the_working_copy(tmp_path, capsys):
    toy = make_toy(tmp_path)
    (toy / 'draft.txt').write_text(f'{TOY_NAME}\n', encoding='utf-8')     # on disk, never committed
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 0


# --- --rev ---------------------------------------------------------------------------------------------------------

def test_rev_scans_and_publishes_the_branch_it_names(tmp_path, capsys):
    toy = make_toy(tmp_path)
    dirty(toy, 'name')
    git(toy, 'switch', '-q', '-c', 'side')
    (toy / 'who.txt').write_text('Written by the trainee.\n', encoding='utf-8')
    git(toy, 'commit', '-q', '-am', 'docs: no owner name')
    git(toy, 'switch', '-q', 'main')
    assert run(capsys, '--scan-only', '--repo', str(toy), '--rev', 'side')[0] == 0
    assert run(capsys, '--scan-only', '--repo', str(toy))[0] == 1
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk', '--rev', 'side'))
    assert code == 0
    clone = tmp_path / 'work' / 'clean'
    assert git(clone, 'rev-parse', 'publish^{tree}') == git(toy, 'rev-parse', 'side^{tree}')
    assert git(toy, 'rev-parse', 'side^{tree}') != git(toy, 'rev-parse', 'main^{tree}')
    assert_no_leak(out)


# --- no path leaks, no traceback -------------------------------------------------------------------------------------

def test_no_absolute_path_and_no_marker_inside_a_printed_path(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(ph, 'os_username', lambda: 'leakword')
    toy = make_toy(tmp_path)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'leakword-work', tmp_path / 'leakword-bk'))
    assert code == 0
    assert 'leakword' not in out.lower()
    assert str(tmp_path).lower() not in out.lower() and tmp_path.as_posix().lower() not in out.lower()
    assert 'clean/' in out

    (toy / 'docs').mkdir()
    (toy / 'docs' / 'leakword-notes.md').write_text('notes\n', encoding='utf-8')
    git(toy, 'add', 'docs')
    git(toy, 'commit', '-q', '-m', 'add notes')
    code, out = run(capsys, *publish_args(toy, tmp_path / 'leakword-work2', tmp_path / 'leakword-bk2'))
    assert code == 1
    assert 'leakword' not in out.lower()
    assert re.search(r'docs/#\d+ \(user, 8 chars\)-notes\.md', out)


def test_an_unexpected_error_prints_masked_with_no_traceback(tmp_path, capsys, monkeypatch):
    toy = make_toy(tmp_path)

    def boom(repo):
        raise RuntimeError(f'boom in {tmp_path} for {TOY_NAME} at {win_profile(TOY_USER)}\\x')
    monkeypatch.setattr(ph, 'state_of', boom)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1
    assert 'Traceback' not in out and 'RuntimeError' in out
    assert str(tmp_path).lower() not in out.lower()
    assert_no_leak(out)


def test_a_bad_argument_prints_masked_and_returns_1(capsys):
    code, out = run(capsys, '--scan-only', '--no-such-flag', TOY_EMAIL)
    assert code == 1
    assert_no_leak(out)


def test_a_marker_equal_to_the_github_user_is_refused_loudly(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(ph, 'os_username', lambda: GH)
    toy = make_toy(tmp_path)
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    assert code == 1
    assert '--github-user' in out and 'equal' in out
    assert GH not in out
    assert not (tmp_path / 'bk').exists() and not (tmp_path / 'work').exists()


# --- this repo's state: read-only, and it sees inside sources/ -------------------------------------------------------

def test_state_of_never_rewrites_the_index(tmp_path):
    toy = make_toy(tmp_path)
    index = toy / '.git' / 'index'
    before = index.read_bytes()
    later = time.time() + 10
    os.utime(toy / 'app.txt', (later, later))     # same content, new mtime: a refreshing status would rewrite it
    ph.state_of(toy)
    assert index.read_bytes() == before


def test_state_of_sees_a_change_inside_sources(tmp_path):
    toy = make_toy(tmp_path)
    before = ph.state_of(toy)
    (toy / 'sources' / 'notes.pdf').write_bytes(b'%PDF-1.4 changed\n')
    after = ph.state_of(toy)
    assert ph._halves(before)[0] == ph._halves(after)[0]
    assert ph._halves(before)[1] != ph._halves(after)[1]


def test_the_callers_git_variables_never_steer_the_tool(tmp_path, capsys, monkeypatch):
    toy = make_toy(tmp_path)
    decoy = make_toy(tmp_path, 'decoy')
    decoy_before = ph.state_of(decoy)
    monkeypatch.setenv('GIT_DIR', str(decoy / '.git'))
    monkeypatch.setenv('GIT_WORK_TREE', str(decoy))
    monkeypatch.setenv('GIT_INDEX_FILE', str(decoy / '.git' / 'index'))
    code, out = run(capsys, *publish_args(toy, tmp_path / 'work', tmp_path / 'bk'))
    for var in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'):
        monkeypatch.delenv(var)
    assert code == 0
    assert ph.state_of(decoy) == decoy_before
    assert git(decoy, 'rev-parse', '--verify', '-q', 'publish', check=False) == ''
    assert git(tmp_path / 'work' / 'push.git', 'rev-parse', 'publish^{tree}') == git(toy, 'rev-parse', 'main^{tree}')


# --- the checks themselves -----------------------------------------------------------------------------------------

def test_verify_sees_a_moved_ref_a_changed_working_tree_and_a_different_tree(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH})
    before = ph.state_of(toy)
    clone = ph.make_clone(toy, tmp_path / 'work')
    snap = ph.build_snapshot(clone, GH, GH_EMAIL)
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers)
    assert report.ok, report.problems
    git(toy, 'branch', 'stray')
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers)
    assert not report.refs_untouched and report.worktree_untouched and not report.ok
    git(toy, 'branch', '-q', '-D', 'stray')
    (toy / 'new.txt').write_text('new\n', encoding='utf-8')
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, None, markers)
    assert report.refs_untouched and not report.worktree_untouched and not report.ok
    (toy / 'new.txt').unlink()
    git(toy, 'switch', '-q', '-c', 'side')
    (toy / 'app.txt').write_text('changed on side\n', encoding='utf-8')
    git(toy, 'commit', '-q', '-am', 'side differs')
    git(toy, 'switch', '-q', 'main')
    report = ph.verify(toy, clone, snap, ph.state_of(toy), GH, GH_EMAIL, None, markers, rev='side')
    assert not report.tree_equal and not report.ok
    assert report.refs_untouched and report.worktree_untouched


def test_verify_checks_the_name_the_email_and_the_parents(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH})
    before = ph.state_of(toy)
    clone = ph.make_clone(toy, tmp_path / 'work')
    snap = ph.build_snapshot(clone, GH, GH_EMAIL)
    report = ph.verify(toy, clone, snap, before, 'someone-else', GH_EMAIL, None, markers)
    assert not report.ok and any('author or committer name' in p for p in report.problems)
    report = ph.verify(toy, clone, snap, before, GH, 'other@users.noreply.github.com', None, markers)
    assert not report.ok and any('author or committer email' in p for p in report.problems)
    report = ph.verify(toy, clone, snap, before, GH, GH_EMAIL, git(toy, 'rev-parse', 'main'), markers)
    assert not report.ok and any('parent' in p for p in report.problems)


def test_scan_commits_flags_a_marker_in_a_commit_and_a_signature(tmp_path):
    toy = make_toy(tmp_path)
    markers = ph.personal_markers(toy, {GH})
    hits = ph.scan_commits(toy, 'main', markers)
    assert hits and all(MASKED.search(h) for h in hits)
    assert_no_leak('\n'.join(hits))
    tree = git(toy, 'rev-parse', 'main^{tree}')
    body = (f'tree {tree}\nauthor {GH} <{GH_EMAIL}> 1700000000 +0800\ncommitter {GH} <{GH_EMAIL}> 1700000000 +0800\n'
            'gpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nsigned\n')
    r = subprocess.run(['git', '-C', str(toy), 'hash-object', '-t', 'commit', '-w', '--stdin'],
                       input=body.encode(), capture_output=True, check=True)     # bytes: no CRLF on Windows
    signed = r.stdout.decode().strip()
    hits = ph.scan_commits(toy, signed, markers)
    assert any('gpgsig' in h for h in hits)


def test_ignored_dirs_reads_the_directory_patterns(tmp_path):
    toy = make_toy(tmp_path)
    (toy / '.gitignore').write_text('# a comment\nnode_modules/\n*.pyc\nsources/\n.superpowers/\n\n!keep/\n',
                                    encoding='utf-8')
    got = ph.ignored_dirs(toy)
    assert got[0] == '.superpowers/'
    assert set(got) == {'.superpowers/', 'node_modules/', 'sources/'}


def test_scan_tree_flags_an_ignored_directory_at_any_depth(tmp_path):
    toy = make_toy(tmp_path)
    (toy / 'tools' / '__pycache__').mkdir(parents=True)
    (toy / 'tools' / '__pycache__' / 'x.pyc').write_bytes(b'\0pyc')
    git(toy, 'add', '-f', 'tools/__pycache__/x.pyc')
    git(toy, 'commit', '-q', '-m', 'oops')
    hits = ph.scan_tree(toy, 'main^{tree}', [], ['.superpowers/', '__pycache__/'])
    assert any('tools/__pycache__/x.pyc' in h for h in hits)


def test_a_marker_in_binary_text_is_found(tmp_path):
    toy = make_toy(tmp_path)
    (toy / 'pic.png').write_bytes(b'\x89PNG\r\n\x1a\n\0\0tEXtAuthor\0' + TOY_NAME.encode() + b'\0\0' +
                                  TOY_USER.encode('utf-16-le') + b'\0')
    git(toy, 'add', 'pic.png')
    git(toy, 'commit', '-q', '-m', 'a picture')
    markers = ph.personal_markers(toy, {GH})
    hits = [h for h in ph.scan_tree(toy, 'main^{tree}', markers, []) if h.startswith('pic.png')]
    assert any('(name, 10 chars)' in h for h in hits) and any('(user, 7 chars)' in h for h in hits)
    assert_no_leak('\n'.join(hits))


# --- the repo itself -----------------------------------------------------------------------------------------------

def tracked_files() -> list[str]:
    return [f for f in git(REPO, 'ls-files', '-z').split('\0') if f]


def test_no_tracked_file_names_a_pages_url():
    hits = []
    for f in tracked_files():
        p = REPO / f
        if p.is_file() and PAGES_URL.search(p.read_bytes().decode('utf-8', errors='ignore')):
            hits.append(f)
    assert hits == []


def test_there_is_no_readme_at_the_repo_root():
    assert [f for f in tracked_files() if '/' not in f and f.lower().startswith('readme')] == []
    assert not [p for p in REPO.iterdir() if p.name.lower().startswith('readme')]


def test_the_publishing_page_names_no_site_url_email_or_readme():
    text = (REPO / 'docs' / 'publishing.md').read_text(encoding='utf-8')
    assert 'EMTNotes' in text and 'crew-leader' not in text and 'tools/publish_history.py' in text
    assert 'https://github.com/<github-user>/EMTNotes.git' in text, 'the push URL names the user by a placeholder'
    assert '--allow-github-user-overlap' in text
    assert not PAGES_URL.search(text)
    assert '@' not in text
    assert '--rev' in text and '--scan-only' in text and '--parent' in text and '--remote' in text
    assert '--extra-marker' in text and '--allow-file' in text


def test_the_publishing_page_passes_the_former_owner_value_through_a_marker_file():
    text = (REPO / 'docs' / 'publishing.md').read_text(encoding='utf-8')
    assert '--extra-marker-file' in text and 'former Owner value' in text
    assert 'outside the project folder' in text and 'shell history' in text
    assert 'push.git' in text and '/clean push' not in text
    assert 'c1c3ef5' in text
