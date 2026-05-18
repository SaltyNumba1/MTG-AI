# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

openai_datas, openai_binaries, openai_hiddenimports = collect_all('openai')
httpx_datas, httpx_binaries, httpx_hiddenimports = collect_all('httpx')
httpcore_datas, httpcore_binaries, httpcore_hiddenimports = collect_all('httpcore')

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[] + openai_binaries + httpx_binaries + httpcore_binaries,
    datas=[
        ('services/synergy_map.json', 'services'),
        ('.env', '.'),
    ] + openai_datas + httpx_datas + httpcore_datas,
    hiddenimports=[
        'aiosqlite',
        'sqlalchemy',
        'sqlalchemy.dialects',
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.dialects.sqlite.aiosqlite',
        'sqlalchemy.ext.asyncio',
        'sqlalchemy.orm',
        'sqlalchemy.pool',
    ] + openai_hiddenimports + httpx_hiddenimports + httpcore_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='mtg-collection',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
