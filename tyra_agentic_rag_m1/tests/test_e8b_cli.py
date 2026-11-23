from pathlib import Path
import importlib.util
import ast


def test_idempotent_patching(tmp_path):
    # Read a small but syntactically valid CLI stub with E8A dispatch.
    code='''from .e7_validation import utc_stamp
from .e8a import run_e8a_detection
from .local_llm import OllamaJSON

def register(batch):
    batch.add_argument('--method',choices=['baseline','traditional','e7','e8a'])
    batch.add_argument('--max-rounds',type=int,default=2)

def run_batch(args):
    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')
    llm=OllamaJSON()
    if args.method == 'e8a':
        from .e8a import run_e8a_detection
        result=run_e8a_detection(retriever,llm,args.max_rounds)
    elif args.method == 'e7':
        result=None
'''
    f=tmp_path/'cli.py';f.write_text(code)
    source=Path(__file__).resolve().parents[1]/'patch_cli_e8b.py'
    spec=importlib.util.spec_from_file_location('e8b_cli_patch',source)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    assert module.patch(f) is True
    one=f.read_text()
    ast.parse(one)
    assert "'e8b'" in one and '--e8b-context-db' in one
    assert module.patch(f) is False
    assert f.read_text()==one
