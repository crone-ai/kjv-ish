#!/usr/bin/env python3
"""Prepare a public-only STEP library from a built local STEP checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def copy_module(source, target, conf, module):
    raw = conf.read_text(encoding="utf-8", errors="replace")
    relative = Path(re.search(r"^DataPath=\./(.*)$", raw, re.M)[1].strip())
    if not relative.is_relative_to("modules") or ".." in relative.parts:
        raise ValueError(f"Unexpected module path for {module}")
    data = source / relative
    if data.is_dir():
        shutil.copytree(data, target / relative, dirs_exist_ok=True)
    else:
        for part in data.parent.glob(data.name + ".*"):
            dest = target / part.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(part, dest)
    shutil.copy2(conf, target / "mods.d" / conf.name)


def prepare(private, runtime):
    public = set(json.loads((ROOT / "reader/library.json").read_text()))
    source = private / "runtime/sword"
    sword = runtime / "sword"
    (sword / "mods.d").mkdir(parents=True, exist_ok=True)
    selected = {}
    for conf in sorted((source / "mods.d").glob("*.conf")):
        match = re.search(r"^\[([^\]\r\n]+)\]", conf.read_text(encoding="utf-8", errors="replace"), re.M)
        module = match[1] if match else None
        if module in public - {"KJVish"}:
            copy_module(source, sword, conf, module)
            selected[conf.name] = module
    with zipfile.ZipFile(private / "runtime/kjvish/build/KJVish.zip") as archive:
        for name in archive.namelist():
            path = Path(name)
            if path != Path("mods.d/kjvish.conf") and (not path.is_relative_to("modules/texts/rawtext/kjvish") or ".." in path.parts):
                raise ValueError("Unexpected KJV-ish module archive path")
            target = sword / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
    selected["kjvish.conf"] = "KJVish"
    if set(selected.values()) != public or {p.name for p in (sword / "mods.d").glob("*.conf")} != set(selected):
        raise ValueError("The public STEP library does not match its allowlist")
    shutil.copytree(private / "runtime/jsword/step", runtime / "jsword/step", dirs_exist_ok=True)
    for edition in ("KJV", "BSB"):
        source_index = private / "runtime/jsword/lucene/Sword" / edition
        if source_index.is_dir():
            shutil.copytree(source_index, runtime / "jsword/lucene/Sword" / edition, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("write.lock"))
    print(f"Prepared {len(selected)} public STEP resources")


def serve(private, runtime, port):
    java = next(t for t in json.loads((private / "config/toolchain.lock.json").read_text())["tools"] if t["name"] == "java8")
    executable = private / java["home"] / "bin/java"
    (runtime / "tmp").mkdir(parents=True, exist_ok=True)
    (runtime / "home").mkdir(parents=True, exist_ok=True)
    jar = private / "upstream/step/step-server/target/step-server-26.11.2.jar"
    web = private / "upstream/step/step-web/target/step-web"
    # Only the site gateway can reach this separate loopback engine.
    args = [str(executable), "-Xmx1g", "-Djava.awt.headless=true", f"-Duser.home={runtime}/home",
            f"-Djava.io.tmpdir={runtime}/tmp", f"-Djsword.home={runtime}/jsword", f"-Dsword.home={runtime}/sword",
            "-Dstep.skipBookInstallation=true", f"-Dstep.war.path={web}", f"-Dstep.war.port={port}",
            "-cp", f"{jar}{os.pathsep}{private}/runtime/lib/*", "com.tyndalehouse.step.server.STEPTomcatServer", "backgroundLaunch"]
    os.chdir(runtime)
    os.execv(executable, args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "serve"))
    parser.add_argument("--step-checkout", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=ROOT / ".site-runtime/step")
    parser.add_argument("--port", type=int, default=8994)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.step_checkout.resolve(), args.state.resolve())
    else:
        serve(args.step_checkout.resolve(), args.state.resolve(), args.port)
