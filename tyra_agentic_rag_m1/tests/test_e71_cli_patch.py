import importlib.util
from pathlib import Path


def test_cli_patch_idempotent(tmp_path):
    root = Path(__file__).resolve().parents[1]
    patched = tmp_path / "cli.py"
    patched.write_text("""def main():
    batch.add_argument('--method',choices=['baseline','e7'])
    batch.add_argument('--max-rounds',type=int,default=2)
    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')
    llm=OllamaJSON()
    for t in origins:
                if args.method == 'e7':
                    from .e7 import run_e7_detection
""", encoding="utf-8")
    spec = importlib.util.spec_from_file_location("patch_e71_test", root / "patch_cli_e71.py")
    patcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patcher)
    patcher.patch_cli(patched)
    first = patched.read_text()
    patcher.patch_cli(patched)
    assert patched.read_text() == first
    assert "'e71'" in first
    assert "from .e71 import run_e71_detection" in first
    assert "--e71-screening-file" in first
