import importlib.util
from pathlib import Path


def test_cli_patch_idempotent(tmp_path):
    root = Path(__file__).resolve().parents[1]
    patched = tmp_path / "cli.py"
    cli = (root / "../tyra_e7_dual_stage_patch/src/cli.py").resolve()
    if cli.is_file():
        patched.write_text(cli.read_text())
    else:
        patched.write_text("""batch.add_argument('--method',choices=['baseline','e7'])
    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')
                if args.method == 'e7':
                    from .e7 import run_e7_detection
""")
    spec = importlib.util.spec_from_file_location("patch_e71_test", root / "patch_cli_e71.py")
    patcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patcher)
    patcher.patch_cli(patched)
    first = patched.read_text()
    patcher.patch_cli(patched)
    assert patched.read_text() == first
    assert "'e71'" in first
    assert "from .e71 import run_e71_detection" in first
