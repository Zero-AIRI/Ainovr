"""Capture a Windows app in the background with PrintWindow(PW_RENDERFULLCONTENT)."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
from ctypes import wintypes
from pathlib import Path

from PIL import Image


class Rect(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class BitmapInfoHeader(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BitmapInfo(ctypes.Structure):
    _fields_ = [("bmiHeader", BitmapInfoHeader), ("bmiColors", wintypes.DWORD * 3)]


USER32 = ctypes.WinDLL("user32", use_last_error=True)
GDI32 = ctypes.WinDLL("gdi32", use_last_error=True)
PW_RENDERFULLCONTENT = 2
DIB_RGB_COLORS = 0


def capture(hwnd: int, output: Path) -> dict[str, object]:
    rect = Rect()
    if not USER32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < 1 or height < 1:
        raise ValueError(f"Invalid window bounds: {width}x{height}")

    source_dc = USER32.GetWindowDC(wintypes.HWND(hwnd))
    if not source_dc:
        raise ctypes.WinError(ctypes.get_last_error())
    memory_dc = GDI32.CreateCompatibleDC(source_dc)
    bitmap = GDI32.CreateCompatibleBitmap(source_dc, width, height)
    if not memory_dc or not bitmap:
        if bitmap:
            GDI32.DeleteObject(bitmap)
        if memory_dc:
            GDI32.DeleteDC(memory_dc)
        USER32.ReleaseDC(wintypes.HWND(hwnd), source_dc)
        raise ctypes.WinError(ctypes.get_last_error())

    previous = GDI32.SelectObject(memory_dc, bitmap)
    try:
        if not USER32.PrintWindow(wintypes.HWND(hwnd), memory_dc, PW_RENDERFULLCONTENT):
            raise ctypes.WinError(ctypes.get_last_error())
        info = BitmapInfo()
        info.bmiHeader.biSize = ctypes.sizeof(BitmapInfoHeader)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = 0
        pixels = ctypes.create_string_buffer(width * height * 4)
        lines = GDI32.GetDIBits(memory_dc, bitmap, 0, height, pixels, ctypes.byref(info), DIB_RGB_COLORS)
        if lines != height:
            raise ctypes.WinError(ctypes.get_last_error())
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.frombuffer("RGBA", (width, height), pixels, "raw", "BGRA", 0, 1).save(output, "PNG")
    finally:
        GDI32.SelectObject(memory_dc, previous)
        GDI32.DeleteObject(bitmap)
        GDI32.DeleteDC(memory_dc)
        USER32.ReleaseDC(wintypes.HWND(hwnd), source_dc)

    return {
        "path": str(output),
        "width": width,
        "height": height,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest().upper(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hwnd", required=True, type=lambda value: int(value, 0))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(capture(args.hwnd, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
