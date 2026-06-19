#include <napi.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <CommCtrl.h>
#include <commoncontrols.h>
#include <shobjidl.h>
#include <string>
#include <vector>
#include <atomic>
#include <algorithm>
#include <map>
#include <mutex>
#include <thread>
#include <sstream>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <winreg.h>
#include <thread>
#include <atomic>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "gdi32.lib")

// SHGetImageList (jumbo icons)
#ifndef SHIL_JUMBO
#define SHIL_JUMBO 0x0004
#endif

static HRESULT (WINAPI *pSHGetImageList)(int, REFIID, void**) = nullptr;

// Certains SDK n'exposent pas IID_IImageList selon les macros/headers inclus.
// On ne le définit PAS ici (sinon double définition au link). On le déclare.
#ifndef IID_IImageList
EXTERN_C const IID IID_IImageList;
#endif

static bool EnsureSHGetImageList() {
  if (pSHGetImageList) return true;
  HMODULE h = LoadLibraryW(L"shell32.dll");
  if (!h) return false;
  pSHGetImageList = (decltype(pSHGetImageList))GetProcAddress(h, "SHGetImageList");
  return pSHGetImageList != nullptr;
}

static HBITMAP TryGetJumboIconBitmap(const std::wstring& wpath, int size) {
  if (!EnsureSHGetImageList()) return nullptr;

  SHFILEINFOW sfi = {};
  if (!SHGetFileInfoW(wpath.c_str(), 0, &sfi, sizeof(sfi), SHGFI_SYSICONINDEX)) return nullptr;

  IImageList* iml = nullptr;
  HRESULT hr = pSHGetImageList(SHIL_JUMBO, IID_IImageList, (void**)&iml);
  if (FAILED(hr) || !iml) return nullptr;

  HICON hIcon = nullptr;
  hr = iml->GetIcon(sfi.iIcon, ILD_TRANSPARENT, &hIcon);
  iml->Release();
  if (FAILED(hr) || !hIcon) return nullptr;

  HDC hdc = GetDC(nullptr);
  HDC memDC = CreateCompatibleDC(hdc);
  HBITMAP hBmp = CreateCompatibleBitmap(hdc, size, size);
  auto hOld = SelectObject(memDC, hBmp);
  RECT rc = { 0, 0, size, size };
  FillRect(memDC, &rc, (HBRUSH)GetStockObject(BLACK_BRUSH));
  DrawIconEx(memDC, 0, 0, hIcon, size, size, 0, nullptr, DI_NORMAL);
  SelectObject(memDC, hOld);
  DeleteDC(memDC);
  ReleaseDC(nullptr, hdc);
  DestroyIcon(hIcon);

  return hBmp;
}

// ── Conversion UTF-8 (Node) ↔ UTF-16 (Windows) ──────────────────────────────

static std::wstring Utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  if (len <= 1) return {};
  // len inclut le \0 terminal → on ne le stocke pas dans std::wstring
  std::wstring result((size_t)len - 1, 0);
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &result[0], len);
  return result;
}

static std::string Utf8FirstLine(const std::string& s) {
  const size_t pos = s.find('\n');
  if (pos == std::string::npos) return s;
  return s.substr(0, pos);
}

static inline void TrimLineEnd(std::string& s) {
  while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ' || s.back() == '\t')) s.pop_back();
}

static std::string WideToUtf8(const std::wstring& ws) {
  if (ws.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), nullptr, 0, nullptr, nullptr);
  std::string out(len, 0);
  WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), &out[0], len, nullptr, nullptr);
  return out;
}

// ── OLE Drag & Drop (CF_HDROP multi-fichiers) ────────────────────────────────

static HGLOBAL CreateHDropFromPaths(const std::vector<std::wstring>& paths) {
  // DROPFILES + concat des chemins en UTF-16 séparés par \0 et terminés par \0\0
  size_t chars = 0;
  for (const auto& p0 : paths) {
    std::wstring p = p0;
    if (!p.empty() && p.back() == L'\0') p.pop_back();
    chars += p.size() + 1;
  }
  chars += 1;

  const size_t bytes = sizeof(DROPFILES) + chars * sizeof(wchar_t);
  HGLOBAL h = GlobalAlloc(GHND | GMEM_SHARE, bytes);
  if (!h) return nullptr;

  auto* df = (DROPFILES*)GlobalLock(h);
  if (!df) { GlobalFree(h); return nullptr; }
  df->pFiles = sizeof(DROPFILES);
  df->fWide = TRUE;

  wchar_t* out = (wchar_t*)((BYTE*)df + sizeof(DROPFILES));
  for (const auto& p0 : paths) {
    std::wstring p = p0;
    if (!p.empty() && p.back() == L'\0') p.pop_back();
    memcpy(out, p.c_str(), p.size() * sizeof(wchar_t));
    out += p.size();
    *out++ = L'\0';
  }
  *out++ = L'\0';

  GlobalUnlock(h);
  return h;
}

static HGLOBAL CreateHGlobalFromUtf8(const std::string& s) {
  // Stocker en bytes + \0 pour simplifier côté lecteur.
  const size_t bytes = s.size() + 1;
  HGLOBAL h = GlobalAlloc(GHND | GMEM_SHARE, bytes);
  if (!h) return nullptr;
  void* p = GlobalLock(h);
  if (!p) { GlobalFree(h); return nullptr; }
  memcpy(p, s.c_str(), bytes);
  GlobalUnlock(h);
  return h;
}

class SimpleDataObject : public IDataObject {
public:
  explicit SimpleDataObject(HGLOBAL hdrop, HGLOBAL internal, DWORD preferredEffect)
    : ref_(1), hdrop_(hdrop), internal_(internal), preferredEffect_(preferredEffect) {
    cfPreferredDropEffect_ = (CLIPFORMAT)RegisterClipboardFormatW(L"Preferred DropEffect");
    cfInternal_ = (CLIPFORMAT)RegisterClipboardFormatW(L"BoxesInternalDrag");
  }
  ~SimpleDataObject() {
    if (hdrop_) GlobalFree(hdrop_);
    if (internal_) GlobalFree(internal_);
  }

  HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IDataObject) {
      *ppv = static_cast<IDataObject*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG __stdcall AddRef() override { return (ULONG)++ref_; }
  ULONG __stdcall Release() override {
    ULONG r = (ULONG)--ref_;
    if (r == 0) delete this;
    return r;
  }

  HRESULT __stdcall GetData(FORMATETC* pFormatEtc, STGMEDIUM* pMedium) override {
    if (!pFormatEtc || !pMedium) return E_INVALIDARG;
    if (!(pFormatEtc->tymed & TYMED_HGLOBAL)) return DV_E_TYMED;
    const CLIPFORMAT cf = pFormatEtc->cfFormat;

    if (cfInternal_ && internal_ && cf == cfInternal_) {
      SIZE_T sz = GlobalSize(internal_);
      HGLOBAL dup = GlobalAlloc(GHND | GMEM_SHARE, sz);
      if (!dup) return E_OUTOFMEMORY;
      void* src = GlobalLock(internal_);
      void* dst = GlobalLock(dup);
      if (!src || !dst) {
        if (src) GlobalUnlock(internal_);
        if (dst) GlobalUnlock(dup);
        GlobalFree(dup);
        return E_FAIL;
      }
      memcpy(dst, src, sz);
      GlobalUnlock(internal_);
      GlobalUnlock(dup);
      pMedium->tymed = TYMED_HGLOBAL;
      pMedium->hGlobal = dup;
      pMedium->pUnkForRelease = nullptr;
      return S_OK;
    }

    if (cf == CF_HDROP) {
      // Dupliquer le HGLOBAL pour respecter le contrat OLE
      SIZE_T sz = GlobalSize(hdrop_);
      HGLOBAL dup = GlobalAlloc(GHND | GMEM_SHARE, sz);
      if (!dup) return E_OUTOFMEMORY;
      void* src = GlobalLock(hdrop_);
      void* dst = GlobalLock(dup);
      if (!src || !dst) {
        if (src) GlobalUnlock(hdrop_);
        if (dst) GlobalUnlock(dup);
        GlobalFree(dup);
        return E_FAIL;
      }
      memcpy(dst, src, sz);
      GlobalUnlock(hdrop_);
      GlobalUnlock(dup);

      pMedium->tymed = TYMED_HGLOBAL;
      pMedium->hGlobal = dup;
      pMedium->pUnkForRelease = nullptr;
      return S_OK;
    }

    if (cfPreferredDropEffect_ && cf == cfPreferredDropEffect_) {
      HGLOBAL h = GlobalAlloc(GHND | GMEM_SHARE, sizeof(DWORD));
      if (!h) return E_OUTOFMEMORY;
      DWORD* d = (DWORD*)GlobalLock(h);
      if (!d) { GlobalFree(h); return E_FAIL; }
      *d = preferredEffect_;
      GlobalUnlock(h);
      pMedium->tymed = TYMED_HGLOBAL;
      pMedium->hGlobal = h;
      pMedium->pUnkForRelease = nullptr;
      return S_OK;
    }

    return DV_E_FORMATETC;
  }

  HRESULT __stdcall GetDataHere(FORMATETC*, STGMEDIUM*) override { return DATA_E_FORMATETC; }
  HRESULT __stdcall QueryGetData(FORMATETC* pFormatEtc) override {
    if (!pFormatEtc) return E_INVALIDARG;
    if (!(pFormatEtc->tymed & TYMED_HGLOBAL)) return DV_E_TYMED;
    if (cfInternal_ && internal_ && pFormatEtc->cfFormat == cfInternal_) return S_OK;
    if (pFormatEtc->cfFormat == CF_HDROP) return S_OK;
    if (cfPreferredDropEffect_ && pFormatEtc->cfFormat == cfPreferredDropEffect_) return S_OK;
    return DV_E_FORMATETC;
  }
  HRESULT __stdcall GetCanonicalFormatEtc(FORMATETC*, FORMATETC*) override { return E_NOTIMPL; }
  HRESULT __stdcall SetData(FORMATETC*, STGMEDIUM*, BOOL) override { return E_NOTIMPL; }
  HRESULT __stdcall EnumFormatEtc(DWORD dwDirection, IEnumFORMATETC** ppenumFormatEtc) override;
  HRESULT __stdcall DAdvise(FORMATETC*, DWORD, IAdviseSink*, DWORD*) override { return OLE_E_ADVISENOTSUPPORTED; }
  HRESULT __stdcall DUnadvise(DWORD) override { return OLE_E_ADVISENOTSUPPORTED; }
  HRESULT __stdcall EnumDAdvise(IEnumSTATDATA**) override { return OLE_E_ADVISENOTSUPPORTED; }

private:
  std::atomic<long> ref_;
  HGLOBAL hdrop_;
  HGLOBAL internal_;
  DWORD preferredEffect_;
  CLIPFORMAT cfPreferredDropEffect_ = 0;
  CLIPFORMAT cfInternal_ = 0;
};

class SimpleEnumFormatEtc : public IEnumFORMATETC {
public:
  explicit SimpleEnumFormatEtc(std::vector<FORMATETC> formats)
    : ref_(1), idx_(0), formats_(std::move(formats)) {}

  HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IEnumFORMATETC) {
      *ppv = static_cast<IEnumFORMATETC*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG __stdcall AddRef() override { return (ULONG)++ref_; }
  ULONG __stdcall Release() override {
    ULONG r = (ULONG)--ref_;
    if (r == 0) delete this;
    return r;
  }

  HRESULT __stdcall Next(ULONG celt, FORMATETC* rgelt, ULONG* pceltFetched) override {
    if (!rgelt) return E_POINTER;
    ULONG fetched = 0;
    while (fetched < celt && idx_ < formats_.size()) {
      rgelt[fetched] = formats_[idx_++];
      fetched++;
    }
    if (pceltFetched) *pceltFetched = fetched;
    return (fetched == celt) ? S_OK : S_FALSE;
  }
  HRESULT __stdcall Skip(ULONG celt) override {
    idx_ = (ULONG)std::min<size_t>(formats_.size(), (size_t)idx_ + (size_t)celt);
    return (idx_ < formats_.size()) ? S_OK : S_FALSE;
  }
  HRESULT __stdcall Reset() override { idx_ = 0; return S_OK; }
  HRESULT __stdcall Clone(IEnumFORMATETC** ppEnum) override {
    if (!ppEnum) return E_POINTER;
    auto* e = new SimpleEnumFormatEtc(formats_);
    e->idx_ = idx_;
    *ppEnum = e;
    return S_OK;
  }

private:
  std::atomic<long> ref_;
  ULONG idx_;
  std::vector<FORMATETC> formats_;
};

HRESULT __stdcall SimpleDataObject::EnumFormatEtc(DWORD dwDirection, IEnumFORMATETC** ppenumFormatEtc) {
  if (!ppenumFormatEtc) return E_POINTER;
  *ppenumFormatEtc = nullptr;
  if (dwDirection != DATADIR_GET) return E_NOTIMPL;

  std::vector<FORMATETC> fmts;

  if (cfInternal_ && internal_) {
    FORMATETC fi = {};
    fi.cfFormat = cfInternal_;
    fi.dwAspect = DVASPECT_CONTENT;
    fi.lindex = -1;
    fi.tymed = TYMED_HGLOBAL;
    fmts.push_back(fi);
  }

  FORMATETC f1 = {};
  f1.cfFormat = CF_HDROP;
  f1.dwAspect = DVASPECT_CONTENT;
  f1.lindex = -1;
  f1.tymed = TYMED_HGLOBAL;
  fmts.push_back(f1);

  if (cfPreferredDropEffect_) {
    FORMATETC f2 = {};
    f2.cfFormat = cfPreferredDropEffect_;
    f2.dwAspect = DVASPECT_CONTENT;
    f2.lindex = -1;
    f2.tymed = TYMED_HGLOBAL;
    fmts.push_back(f2);
  }

  *ppenumFormatEtc = new SimpleEnumFormatEtc(std::move(fmts));
  return S_OK;
}

class SimpleDropSource : public IDropSource {
public:
  SimpleDropSource() : ref_(1) {}
  HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IDropSource) {
      *ppv = static_cast<IDropSource*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG __stdcall AddRef() override { return (ULONG)++ref_; }
  ULONG __stdcall Release() override {
    ULONG r = (ULONG)--ref_;
    if (r == 0) delete this;
    return r;
  }

  HRESULT __stdcall QueryContinueDrag(BOOL fEscapePressed, DWORD grfKeyState) override {
    if (fEscapePressed) return DRAGDROP_S_CANCEL;
    if (!(grfKeyState & MK_LBUTTON)) return DRAGDROP_S_DROP;
    return S_OK;
  }
  HRESULT __stdcall GiveFeedback(DWORD) override { return DRAGDROP_S_USEDEFAULTCURSORS; }

private:
  std::atomic<long> ref_;
};

static DWORD DoDragDropBlocking(const std::vector<std::wstring>& paths) {
  DWORD effect = 0;
  // OLE drag&drop fonctionne de façon fiable quand DoDragDrop est appelé
  // sur le thread appelant (pas sur un worker thread).
  HRESULT hr = OleInitialize(nullptr);

  HGLOBAL hdrop = CreateHDropFromPaths(paths);
  if (!hdrop) {
    if (SUCCEEDED(hr)) OleUninitialize();
    return 0;
  }

  IDataObject* dataObj = new SimpleDataObject(hdrop, nullptr, DROPEFFECT_MOVE);
  IDropSource* dropSrc = new SimpleDropSource();

  // Forcer MOVE uniquement : évite les copies asynchrones (fichier visible
  // mais encore en cours de copie) qui empêchent de le re-déplacer immédiatement.
  (void)DoDragDrop(dataObj, dropSrc, DROPEFFECT_MOVE, &effect);

  dropSrc->Release();
  dataObj->Release();

  if (SUCCEEDED(hr)) OleUninitialize();
  return effect;
}

Napi::Value StartFileDrag(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "Expected array of file paths").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string internalJson;
  if (info.Length() >= 2 && info[1].IsString()) {
    internalJson = info[1].As<Napi::String>().Utf8Value();
  }
  auto arr = info[0].As<Napi::Array>();
  std::vector<std::wstring> paths;
  paths.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr.Get(i);
    if (!v.IsString()) continue;
    auto w = Utf8ToWide(v.As<Napi::String>().Utf8Value());
    if (!w.empty()) paths.push_back(w);
  }
  if (paths.empty()) return env.Null();

  // Appel bloquant (modal) : fiable pour le Shell Windows.
  // IMPORTANT: on le déclenche hors du handler dragstart côté renderer (setTimeout),
  // pour ne pas laisser le drag HTML5 prendre le dessus.
  DWORD effect = 0;
  HRESULT hr = OleInitialize(nullptr);
  HGLOBAL hdrop = CreateHDropFromPaths(paths);
  HGLOBAL hint = internalJson.empty() ? nullptr : CreateHGlobalFromUtf8(internalJson);
  if (hdrop) {
    IDataObject* dataObj = new SimpleDataObject(hdrop, hint, DROPEFFECT_MOVE);
    IDropSource* dropSrc = new SimpleDropSource();
    (void)DoDragDrop(dataObj, dropSrc, DROPEFFECT_MOVE, &effect);
    dropSrc->Release();
    dataObj->Release();
  } else if (hint) {
    GlobalFree(hint);
  }
  if (SUCCEEDED(hr)) OleUninitialize();
  return Napi::Number::New(env, (double)effect);
}

Napi::Value GetWindowClassUnderCursor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  POINT pt;
  if (!GetCursorPos(&pt)) return env.Null();
  HWND h = WindowFromPoint(pt);
  if (!h) return env.Null();
  wchar_t cls[256] = {0};
  int n = GetClassNameW(h, cls, 255);
  if (n <= 0) return env.Null();
  std::wstring wcls(cls, cls + n);
  return Napi::String::New(env, WideToUtf8(wcls));
}

// ── DropTarget OLE (register/revoke) ─────────────────────────────────────────

struct DropPayload {
  std::string kind; // "internal" | "files"
  std::string internal;
  std::vector<std::string> files;
};

class BoxesDropTarget : public IDropTarget {
public:
  BoxesDropTarget(Napi::Env env, Napi::Function cb)
    : ref_(1), lastEffect_(DROPEFFECT_NONE) {
    cfInternal_ = (CLIPFORMAT)RegisterClipboardFormatW(L"BoxesInternalDrag");
    tsfn_ = Napi::ThreadSafeFunction::New(env, cb, "BoxesDropTarget", 0, 1);
  }
  ~BoxesDropTarget() {
    tsfn_.Release();
  }

  HRESULT __stdcall QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IDropTarget) {
      *ppv = static_cast<IDropTarget*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG __stdcall AddRef() override { return (ULONG)++ref_; }
  ULONG __stdcall Release() override {
    ULONG r = (ULONG)--ref_;
    if (r == 0) delete this;
    return r;
  }

  HRESULT __stdcall DragEnter(IDataObject* pDataObj, DWORD, POINTL, DWORD* pdwEffect) override {
    if (!pdwEffect) return E_INVALIDARG;
    lastEffect_ = QueryEffect(pDataObj);
    *pdwEffect = lastEffect_;
    return S_OK;
  }
  HRESULT __stdcall DragOver(DWORD, POINTL, DWORD* pdwEffect) override {
    if (!pdwEffect) return E_INVALIDARG;
    // Windows s'attend à ce qu'on mette à jour l'effet à CHAQUE DragOver.
    // Si on ne le fait pas, le shell bascule souvent sur DROPEFFECT_NONE (curseur 🚫).
    *pdwEffect = lastEffect_;
    return S_OK;
  }
  HRESULT __stdcall DragLeave() override {
    lastEffect_ = DROPEFFECT_NONE;
    return S_OK;
  }

  HRESULT __stdcall Drop(IDataObject* pDataObj, DWORD, POINTL, DWORD* pdwEffect) override {
    if (!pdwEffect) return E_INVALIDARG;
    DropPayload payload;
    if (HasInternal(pDataObj)) {
      payload.kind = "internal";
      payload.internal = ReadInternal(pDataObj);
      *pdwEffect = DROPEFFECT_MOVE;
    } else {
      payload.kind = "files";
      payload.files = ReadHDrop(pDataObj);
      bool placeholder = false;
      for (const auto& f : payload.files) {
        if (IsBoxesPlaceholderPath(f)) { placeholder = true; break; }
      }
      *pdwEffect = payload.files.empty()
        ? DROPEFFECT_NONE
        : (placeholder ? DROPEFFECT_MOVE : DROPEFFECT_COPY);
    }

    // Notifier JS (main) pour qu'il exécute move/copy + refresh UI
    tsfn_.NonBlockingCall(new DropPayload(std::move(payload)),
      [](Napi::Env env, Napi::Function jsCb, DropPayload* p) {
        Napi::Object o = Napi::Object::New(env);
        o.Set("kind", p->kind);
        if (p->kind == "internal") {
          o.Set("internal", p->internal);
        } else {
          Napi::Array a = Napi::Array::New(env, p->files.size());
          for (size_t i = 0; i < p->files.size(); i++) a.Set((uint32_t)i, p->files[i]);
          o.Set("files", a);
        }
        jsCb.Call({ o });
        delete p;
      });
    return S_OK;
  }

private:
  static bool IsBoxesPlaceholderPath(const std::string& path) {
    const size_t slash = path.find_last_of("\\/");
    const std::string name = (slash == std::string::npos) ? path : path.substr(slash + 1);
    if (name.size() >= 10 && name.rfind("boxes-drag-", 0) == 0) return true;
    return _stricmp(name.c_str(), "boxes-drag-placeholder.tmp") == 0;
  }

  DWORD QueryEffect(IDataObject* pDataObj) {
    if (!pDataObj) return DROPEFFECT_NONE;
    if (HasInternal(pDataObj)) return DROPEFFECT_MOVE;
    FORMATETC fe = { CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    if (pDataObj->QueryGetData(&fe) != S_OK) return DROPEFFECT_NONE;
    const auto files = ReadHDrop(pDataObj);
    for (const auto& f : files) {
      if (IsBoxesPlaceholderPath(f)) return DROPEFFECT_MOVE;
    }
    return DROPEFFECT_COPY;
  }

  bool HasInternal(IDataObject* pDataObj) {
    if (!pDataObj || !cfInternal_) return false;
    FORMATETC fe = { cfInternal_, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    return pDataObj->QueryGetData(&fe) == S_OK;
  }

  std::string ReadInternal(IDataObject* pDataObj) {
    if (!pDataObj || !cfInternal_) return {};
    FORMATETC fe = { cfInternal_, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    STGMEDIUM stg = {};
    if (pDataObj->GetData(&fe, &stg) != S_OK) return {};
    std::string out;
    if (stg.tymed == TYMED_HGLOBAL && stg.hGlobal) {
      const char* p = (const char*)GlobalLock(stg.hGlobal);
      if (p) {
        out = std::string(p);
        GlobalUnlock(stg.hGlobal);
      }
    }
    ReleaseStgMedium(&stg);
    return out;
  }

  std::vector<std::string> ReadHDrop(IDataObject* pDataObj) {
    std::vector<std::string> out;
    if (!pDataObj) return out;
    FORMATETC fe = { CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    STGMEDIUM stg = {};
    if (pDataObj->GetData(&fe, &stg) != S_OK) return out;
    if (stg.tymed == TYMED_HGLOBAL && stg.hGlobal) {
      HDROP hdrop = (HDROP)GlobalLock(stg.hGlobal);
      if (hdrop) {
        UINT count = DragQueryFileW(hdrop, 0xFFFFFFFF, nullptr, 0);
        for (UINT i = 0; i < count; i++) {
          wchar_t buf[MAX_PATH * 4] = {0};
          UINT n = DragQueryFileW(hdrop, i, buf, (UINT)(sizeof(buf)/sizeof(wchar_t)));
          if (n > 0) out.push_back(WideToUtf8(std::wstring(buf, buf + n)));
        }
        GlobalUnlock(stg.hGlobal);
      }
    }
    ReleaseStgMedium(&stg);
    return out;
  }

  std::atomic<long> ref_;
  Napi::ThreadSafeFunction tsfn_;
  CLIPFORMAT cfInternal_ = 0;
  DWORD lastEffect_;
};

static std::mutex g_dropMutex;
static std::map<HWND, BoxesDropTarget*> g_dropTargets;

static std::string HrToHex(HRESULT hr) {
  char buf[32] = {0};
  std::snprintf(buf, sizeof(buf), "0x%08lX", (unsigned long)hr);
  return std::string(buf);
}

static HWND HwndFromNodeBuffer(const Napi::Value& v) {
  if (!v.IsBuffer()) return nullptr;
  auto buf = v.As<Napi::Buffer<uint8_t>>();
  if (buf.Length() < sizeof(void*)) return nullptr;
  void* p = nullptr;
  memcpy(&p, buf.Data(), sizeof(void*));
  return (HWND)p;
}

Napi::Value RegisterDropTarget(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Expected (nativeWindowHandleBuffer, callback)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  HWND hwnd = HwndFromNodeBuffer(info[0]);
  if (!hwnd) return Napi::Boolean::New(env, false);

  HRESULT hr = OleInitialize(nullptr);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    std::fprintf(stdout, "[ole-drop-target][native] OleInitialize failed hr=%s thread=%lu\n",
      HrToHex(hr).c_str(), (unsigned long)GetCurrentThreadId());
    return Napi::Boolean::New(env, false);
  }
  if (hr == RPC_E_CHANGED_MODE) {
    std::fprintf(stdout, "[ole-drop-target][native] OleInitialize changed-mode hr=%s thread=%lu\n",
      HrToHex(hr).c_str(), (unsigned long)GetCurrentThreadId());
  }

  auto* tgt = new BoxesDropTarget(env, info[1].As<Napi::Function>());
  HRESULT r = RegisterDragDrop(hwnd, tgt);
  if (r == DRAGDROP_E_ALREADYREGISTERED) {
    std::fprintf(stdout, "[ole-drop-target][native] RegisterDragDrop already-registered hwnd=%p, trying Revoke+Register\n",
      (void*)hwnd);
    HRESULT rr = RevokeDragDrop(hwnd);
    if (rr != S_OK && rr != DRAGDROP_E_NOTREGISTERED) {
      std::fprintf(stdout, "[ole-drop-target][native] RevokeDragDrop before register failed hr=%s hwnd=%p thread=%lu\n",
        HrToHex(rr).c_str(), (void*)hwnd, (unsigned long)GetCurrentThreadId());
    }
    r = RegisterDragDrop(hwnd, tgt);
  }
  if (r != S_OK) {
    std::fprintf(stdout, "[ole-drop-target][native] RegisterDragDrop failed hr=%s hwnd=%p thread=%lu\n",
      HrToHex(r).c_str(), (void*)hwnd, (unsigned long)GetCurrentThreadId());
    tgt->Release();
    return Napi::Boolean::New(env, false);
  }

  {
    std::lock_guard<std::mutex> lock(g_dropMutex);
    g_dropTargets[hwnd] = tgt;
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value RevokeDropTarget(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected (nativeWindowHandleBuffer)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  HWND hwnd = HwndFromNodeBuffer(info[0]);
  if (!hwnd) return Napi::Boolean::New(env, false);

  BoxesDropTarget* tgt = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_dropMutex);
    auto it = g_dropTargets.find(hwnd);
    if (it != g_dropTargets.end()) { tgt = it->second; g_dropTargets.erase(it); }
  }

  HRESULT r = RevokeDragDrop(hwnd);
  if (r != S_OK && r != DRAGDROP_E_NOTREGISTERED) {
    std::fprintf(stdout, "[ole-drop-target][native] RevokeDragDrop hr=%s hwnd=%p thread=%lu\n",
      HrToHex(r).c_str(), (void*)hwnd, (unsigned long)GetCurrentThreadId());
  }
  if (tgt) tgt->Release();
  return Napi::Boolean::New(env, true);
}

// ── Extraire pixels RGBA depuis un HBITMAP (32bpp) ───────────────────────────

static std::vector<uint8_t> HBitmapToRgba(HBITMAP hBmp, int width, int height) {
  HDC hdc = GetDC(nullptr);

  BITMAPINFOHEADER bih = {};
  bih.biSize        = sizeof(bih);
  bih.biWidth       = width;
  bih.biHeight      = -height; // top-down
  bih.biPlanes      = 1;
  bih.biBitCount    = 32;
  bih.biCompression = BI_RGB;

  std::vector<uint8_t> pixels(width * height * 4);
  GetDIBits(hdc, hBmp, 0, height, pixels.data(), (BITMAPINFO*)&bih, DIB_RGB_COLORS);
  ReleaseDC(nullptr, hdc);

  // Convertir BGRA → RGBA + corriger alpha
  bool hasAlpha = false;
  for (int i = 0; i < width * height; i++) {
    if (pixels[i*4+3]) { hasAlpha = true; break; }
  }
  for (int i = 0; i < width * height; i++) {
    uint8_t blue  = pixels[i*4+0];
    uint8_t green = pixels[i*4+1];
    uint8_t red   = pixels[i*4+2];
    // BGRA → RGBA
    pixels[i*4+0] = red;
    pixels[i*4+2] = blue;
    if (!hasAlpha) {
      // Pas de canal alpha : fond noir = transparent, reste = opaque
      pixels[i*4+3] = (red || green || blue) ? 255 : 0;
    }
  }
  return pixels;
}

// ── SHChangeNotify ───────────────────────────────────────────────────────────

// Marque un fichier HIDDEN uniquement, sans SYSTEM et sans notification Shell.
// Utilisé sur le placeholder AVANT le drag : Windows préserve l'attribut au drop,
// le fichier arrive invisible sur le bureau sans perturber l'IDropTarget du bureau.
Napi::Value SetFileHiddenQuiet(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  std::wstring p = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  DWORD attrs = GetFileAttributesW(p.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES) return Napi::Boolean::New(env, false);
  BOOL ok = SetFileAttributesW(p.c_str(), attrs | FILE_ATTRIBUTE_HIDDEN);
  return Napi::Boolean::New(env, ok != 0);
}

// Masque un fichier immédiatement (HIDDEN+SYSTEM) sans le supprimer,
// puis notifie Explorer pour qu'il disparaisse de la vue.
Napi::Value HideFileNow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return Napi::Boolean::New(env, false);
  std::wstring p = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  DWORD attrs = GetFileAttributesW(p.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES) return Napi::Boolean::New(env, false);
  BOOL ok = SetFileAttributesW(p.c_str(), attrs | FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);
  SHChangeNotify(SHCNE_ATTRIBUTES, SHCNF_PATH | SHCNF_FLUSHNOWAIT, p.c_str(), nullptr);
  return Napi::Boolean::New(env, ok != 0);
}

// Worker asynchrone : SHChangeNotify avec SHCNF_FLUSH sur thread libuv.
// SHCNF_FLUSH garantit qu'Explorer traite la notification immédiatement (via SendMessage),
// mais bloque le thread appelant. En le déportant sur libuv, Node.js n'est pas bloqué.
class ShellNotifyWorker : public Napi::AsyncWorker {
public:
  enum Action { CREATE, DEL, UPDATE_ITEM, REFRESH_DESKTOP };
  ShellNotifyWorker(Napi::Env env, std::wstring p, Action action)
    : Napi::AsyncWorker(env, "ShellNotifyWorker"), p_(p), action_(action) {}

  void Execute() override {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    std::wstring dir = p_.empty() ? L"" : p_.substr(0, p_.find_last_of(L"\\/"));
    if (action_ == CREATE) {
      SHChangeNotify(SHCNE_CREATE,    SHCNF_PATH | SHCNF_FLUSH, p_.c_str(), nullptr);
      if (!dir.empty())
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATH | SHCNF_FLUSH, dir.c_str(), nullptr);
    } else if (action_ == DEL) {
      SHChangeNotify(SHCNE_DELETE,    SHCNF_PATH | SHCNF_FLUSH, p_.c_str(), nullptr);
      if (!dir.empty())
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATH | SHCNF_FLUSH, dir.c_str(), nullptr);
    } else if (action_ == UPDATE_ITEM) {
      SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATH | SHCNF_FLUSH, p_.c_str(), nullptr);
      if (!dir.empty())
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATH | SHCNF_FLUSH, dir.c_str(), nullptr);
    } else if (action_ == REFRESH_DESKTOP) {
      // Force un refresh plus agressif de l'Explorer (cache icônes / raccourcis).
      // Peut aider à réduire le délai visuel après move sur le Bureau.
      SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSH, nullptr, nullptr);
      if (!p_.empty())
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATH | SHCNF_FLUSH, p_.c_str(), nullptr);
    }
    CoUninitialize();
  }
  void OnOK() override {}
  void OnError(const Napi::Error&) override {}

private:
  std::wstring p_;
  Action action_;
};

Napi::Value NotifyShellCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();
  auto* w = new ShellNotifyWorker(env,
    Utf8ToWide(info[0].As<Napi::String>().Utf8Value()), ShellNotifyWorker::CREATE);
  w->Queue();
  return env.Undefined();
}

Napi::Value NotifyShellDelete(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();
  auto* w = new ShellNotifyWorker(env,
    Utf8ToWide(info[0].As<Napi::String>().Utf8Value()), ShellNotifyWorker::DEL);
  w->Queue();
  return env.Undefined();
}

Napi::Value NotifyShellUpdateItem(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();
  auto* w = new ShellNotifyWorker(env,
    Utf8ToWide(info[0].As<Napi::String>().Utf8Value()), ShellNotifyWorker::UPDATE_ITEM);
  w->Queue();
  return env.Undefined();
}

Napi::Value NotifyShellRefreshDesktop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::wstring desktopDir;
  if (info.Length() >= 1 && info[0].IsString()) {
    desktopDir = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  }
  auto* w = new ShellNotifyWorker(env, desktopDir, ShellNotifyWorker::REFRESH_DESKTOP);
  w->Queue();
  return env.Undefined();
}

// ── GetFileIconPng ───────────────────────────────────────────────────────────
// Utilise IShellItemImageFactory::GetImage (comme Windows Explorer)
// → icône toujours mise à l'échelle correctement

Napi::Value GetFileIconPng(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Null();

  std::wstring wpath = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  int size = (info.Length() >= 2 && info[1].IsNumber())
             ? info[1].As<Napi::Number>().Int32Value() : 256;

  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  HBITMAP hBmp = nullptr;

  // ── Méthode 1 : IShellItemImageFactory (comme Explorer, mise à l'échelle propre)
  {
    IShellItem* psi = nullptr;
    if (SUCCEEDED(SHCreateItemFromParsingName(wpath.c_str(), nullptr,
                                              IID_IShellItem, (void**)&psi))) {
      IShellItemImageFactory* psiif = nullptr;
      if (SUCCEEDED(psi->QueryInterface(IID_IShellItemImageFactory, (void**)&psiif))) {
        SIZE sz = { size, size };
        // SIIGBF_ICONONLY : icône (pas miniature), SIIGBF_RESIZETOFIT : mise à l'échelle
        SIIGBF flags = (SIIGBF)(SIIGBF_ICONONLY | SIIGBF_RESIZETOFIT);
        psiif->GetImage(sz, flags, &hBmp);
        psiif->Release();
      }
      psi->Release();
    }
  }

  // ── Méthode 1bis : forcer l'icône jumbo (corrige certains .lnk flous) ──
  // Si Windows renvoie une petite icône malgré size=256, SHGetImageList(SHIL_JUMBO)
  // donne souvent une meilleure qualité.
  if (hBmp) {
    BITMAP bm = {};
    GetObject(hBmp, sizeof(bm), &bm);
    if (bm.bmWidth > 0 && bm.bmWidth < (size / 2)) {
      DeleteObject(hBmp);
      hBmp = TryGetJumboIconBitmap(wpath, size);
    }
  } else {
    hBmp = TryGetJumboIconBitmap(wpath, size);
  }

  // ── Méthode 2 : fallback SHGetFileInfoW LARGEICON
  if (!hBmp) {
    SHFILEINFOW sfi = {};
    if (SHGetFileInfoW(wpath.c_str(), 0, &sfi, sizeof(sfi),
                       SHGFI_ICON | SHGFI_LARGEICON) && sfi.hIcon) {
      // Dessiner l'icône dans un HBITMAP aux dimensions demandées
      HDC hdc   = GetDC(nullptr);
      HDC memDC = CreateCompatibleDC(hdc);
      hBmp = CreateCompatibleBitmap(hdc, size, size);
      auto hOld = SelectObject(memDC, hBmp);
      RECT rc = { 0, 0, size, size };
      FillRect(memDC, &rc, (HBRUSH)GetStockObject(BLACK_BRUSH));
      DrawIconEx(memDC, 0, 0, sfi.hIcon, size, size, 0, nullptr, DI_NORMAL);
      SelectObject(memDC, hOld);
      DeleteDC(memDC);
      ReleaseDC(nullptr, hdc);
      DestroyIcon(sfi.hIcon);
    }
  }

  if (!hBmp) return env.Null();

  // Récupérer les dimensions réelles du bitmap
  BITMAP bm = {};
  GetObject(hBmp, sizeof(bm), &bm);
  int w = bm.bmWidth  > 0 ? bm.bmWidth  : size;
  int h = bm.bmHeight > 0 ? bm.bmHeight : size;

  std::vector<uint8_t> pixels = HBitmapToRgba(hBmp, w, h);
  DeleteObject(hBmp);

  // Vérifier que l'image n'est pas vide
  bool hasContent = false;
  for (size_t i = 0; i < pixels.size(); i += 4) {
    if (pixels[i] || pixels[i+1] || pixels[i+2] || pixels[i+3]) {
      hasContent = true; break;
    }
  }
  if (!hasContent) return env.Null();

  Napi::Object result = Napi::Object::New(env);
  result.Set("width",  Napi::Number::New(env, w));
  result.Set("height", Napi::Number::New(env, h));
  result.Set("data",   Napi::Buffer<uint8_t>::Copy(env, pixels.data(), pixels.size()));
  return result;
}

// ── Bureau Windows : masquer / afficher les icônes (ListView Explorer) ───────

static BOOL CALLBACK EnumChildFindDesktopListView(HWND hwnd, LPARAM lp) {
  wchar_t cls[64] = {};
  if (GetClassNameW(hwnd, cls, 63) <= 0) return TRUE;
  if (wcscmp(cls, L"SysListView32") != 0) return TRUE;
  HWND parent = GetParent(hwnd);
  if (!parent) return TRUE;
  wchar_t pcls[64] = {};
  if (GetClassNameW(parent, pcls, 63) <= 0) return TRUE;
  if (wcscmp(pcls, L"SHELLDLL_DefView") == 0) {
    *(HWND*)lp = hwnd;
    return FALSE;
  }
  return TRUE;
}

static BOOL CALLBACK EnumTopLevelFindDesktopListView(HWND hwnd, LPARAM lp) {
  wchar_t cls[64] = {};
  if (GetClassNameW(hwnd, cls, 63) <= 0) return TRUE;
  if (wcscmp(cls, L"Progman") != 0 && wcscmp(cls, L"WorkerW") != 0) return TRUE;
  if (!EnumChildWindows(hwnd, EnumChildFindDesktopListView, lp)) return FALSE;
  return *(HWND*)lp ? FALSE : TRUE;
}

static HWND FindDesktopListViewHwnd() {
  HWND progman = FindWindowW(L"Progman", nullptr);
  if (progman) {
    DWORD_PTR sendResult = 0;
    SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_ABORTIFHUNG, 1000, &sendResult);
  }
  HWND lv = nullptr;
  EnumWindows(EnumTopLevelFindDesktopListView, (LPARAM)&lv);
  return lv;
}

static bool SetDesktopIconsHideRegistry(bool hide) {
  HKEY hKey = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER,
      L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
      0, KEY_SET_VALUE, &hKey) != ERROR_SUCCESS) {
    return false;
  }
  const DWORD val = hide ? 1u : 0u;
  const LSTATUS st = RegSetValueExW(hKey, L"HideIcons", 0, REG_DWORD,
    reinterpret_cast<const BYTE*>(&val), sizeof(val));
  RegCloseKey(hKey);
  if (st != ERROR_SUCCESS) return false;
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return true;
}

Napi::Value SetDesktopIconsVisible(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    return Napi::Boolean::New(env, false);
  }
  const bool visible = info[0].As<Napi::Boolean>().Value();
  bool ok = false;
  HWND lv = FindDesktopListViewHwnd();
  if (lv) {
    ShowWindow(lv, visible ? SW_SHOW : SW_HIDE);
    InvalidateRect(lv, nullptr, TRUE);
    UpdateWindow(lv);
    ok = true;
  }
  if (!ok) {
    ok = SetDesktopIconsHideRegistry(!visible);
  }
  return Napi::Boolean::New(env, ok);
}

// ── Double-clic bureau : apercu temporaire des icones (style Stardock) ───────
// Hook souris global sur un thread dedie (message loop Windows requis).

static HHOOK g_mouseLlHook = nullptr;
static Napi::ThreadSafeFunction* g_desktopPeekTsfn = nullptr;
static std::thread g_peekHookThread;
static std::atomic<bool> g_peekHookStop{false};
static std::atomic<DWORD> g_peekHookThreadId{0};
static std::atomic<bool> g_desktopDblClickPending{false};
static DWORD g_lastDesktopDownTime = 0;
static POINT g_lastDesktopDownPt = {0, 0};

static void FireDesktopPeekCallback() {
  if (!g_desktopPeekTsfn) return;
  g_desktopPeekTsfn->NonBlockingCall([](Napi::Env env, Napi::Function cb) {
    cb.Call({});
  });
}

static HMODULE GetAddonModuleHandle() {
  HMODULE hm = nullptr;
  GetModuleHandleExW(
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCWSTR>(&FireDesktopPeekCallback),
    &hm);
  return hm;
}

static bool IsDesktopShellClass(const wchar_t* cls) {
  return wcscmp(cls, L"Progman") == 0 || wcscmp(cls, L"WorkerW") == 0 ||
         wcscmp(cls, L"SHELLDLL_DefView") == 0 || wcscmp(cls, L"SysListView32") == 0 ||
         wcscmp(cls, L"DirectUIHWND") == 0 || wcscmp(cls, L"FolderView") == 0;
}

static bool IsPointOnDesktop(POINT pt) {
  HWND hwnd = WindowFromPoint(pt);
  for (int depth = 0; depth < 16 && hwnd; depth++) {
    wchar_t cls[256] = {};
    if (GetClassNameW(hwnd, cls, 255) > 0) {
      if (wcscmp(cls, L"Chrome_RenderWidgetHostHWND") == 0 ||
          wcscmp(cls, L"Chrome_WidgetWin_1") == 0) {
        return false;
      }
      if (IsDesktopShellClass(cls)) return true;
    }
    hwnd = GetParent(hwnd);
  }
  HWND root = GetAncestor(WindowFromPoint(pt), GA_ROOT);
  if (root) {
    wchar_t cls[256] = {};
    if (GetClassNameW(root, cls, 255) > 0 && IsDesktopShellClass(cls)) return true;
  }
  return false;
}

static void SignalDesktopDoubleClick() {
  g_desktopDblClickPending.store(true);
  FireDesktopPeekCallback();
}

static void HandleDesktopMouseDown(const MSLLHOOKSTRUCT* ms) {
  const DWORD now = ms->time;
  const int dx = abs(ms->pt.x - g_lastDesktopDownPt.x);
  const int dy = abs(ms->pt.y - g_lastDesktopDownPt.y);
  const DWORD dblTime = static_cast<DWORD>(GetDoubleClickTime());
  const int dxLimit = GetSystemMetrics(SM_CXDOUBLECLK);
  const int dyLimit = GetSystemMetrics(SM_CYDOUBLECLK);

  if (g_lastDesktopDownTime != 0 &&
      (now - g_lastDesktopDownTime) <= dblTime &&
      dx <= dxLimit && dy <= dyLimit) {
    g_lastDesktopDownTime = 0;
    SignalDesktopDoubleClick();
    return;
  }

  g_lastDesktopDownTime = now;
  g_lastDesktopDownPt = ms->pt;
}

static LRESULT CALLBACK DesktopPeekMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION && g_desktopPeekTsfn) {
    auto* ms = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
    if (ms) {
      if (wParam == WM_LBUTTONDOWN) {
        HandleDesktopMouseDown(ms);
      } else if (wParam == WM_LBUTTONDBLCLK) {
        g_lastDesktopDownTime = 0;
        SignalDesktopDoubleClick();
      }
    }
  }
  return CallNextHookEx(g_mouseLlHook, nCode, wParam, lParam);
}

static void ReleaseDesktopPeekHookUnlocked() {
  if (g_mouseLlHook) {
    UnhookWindowsHookEx(g_mouseLlHook);
    g_mouseLlHook = nullptr;
  }
  if (g_desktopPeekTsfn) {
    g_desktopPeekTsfn->Release();
    delete g_desktopPeekTsfn;
    g_desktopPeekTsfn = nullptr;
  }
}

static void PeekHookThreadMain() {
  g_peekHookThreadId.store(GetCurrentThreadId());
  HMODULE hMod = GetAddonModuleHandle();
  if (!hMod) hMod = GetModuleHandleW(nullptr);
  g_mouseLlHook = SetWindowsHookExW(WH_MOUSE_LL, DesktopPeekMouseProc, hMod, 0);

  MSG msg;
  while (!g_peekHookStop.load()) {
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) {
        g_peekHookStop.store(true);
        break;
      }
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (g_peekHookStop.load()) break;
    WaitMessage();
  }
  ReleaseDesktopPeekHookUnlocked();
  g_peekHookThreadId.store(0);
}

static void ReleaseDesktopPeekHook() {
  g_peekHookStop.store(true);
  const DWORD tid = g_peekHookThreadId.load();
  if (tid) PostThreadMessageW(tid, WM_QUIT, 0, 0);
  if (g_peekHookThread.joinable()) {
    g_peekHookThread.join();
  }
  g_peekHookThread = std::thread();
  g_peekHookStop.store(false);
  ReleaseDesktopPeekHookUnlocked();
}

Napi::Value RegisterDesktopPeekHook(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    return Napi::Boolean::New(env, false);
  }
  ReleaseDesktopPeekHook();
  g_desktopPeekTsfn = new Napi::ThreadSafeFunction(
    Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "DesktopPeek", 0, 1));

  g_peekHookStop.store(false);
  g_peekHookThread = std::thread(PeekHookThreadMain);

  // Laisser le thread installer le hook
  for (int i = 0; i < 30 && !g_mouseLlHook; i++) {
    Sleep(10);
  }
  return Napi::Boolean::New(env, g_mouseLlHook != nullptr);
}

Napi::Value UnregisterDesktopPeekHook(const Napi::CallbackInfo& info) {
  ReleaseDesktopPeekHook();
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value ConsumeDesktopDoubleClick(const Napi::CallbackInfo& info) {
  const bool pending = g_desktopDblClickPending.exchange(false);
  return Napi::Boolean::New(info.Env(), pending);
}

// Détection double-clic via polling (main process) — plus fiable que le hook seul.
Napi::Value PollDesktopDoubleClick(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  static bool prevDown = false;
  static ULONGLONG lastClickTick = 0;
  static POINT lastPt = {0, 0};

  const SHORT st = GetAsyncKeyState(VK_LBUTTON);
  const bool down = (st & 0x8000) != 0;
  bool detected = false;

  if (down && !prevDown) {
    POINT pt = {};
    GetCursorPos(&pt);
    const ULONGLONG now = GetTickCount64();
    const DWORD dblTime = static_cast<DWORD>(GetDoubleClickTime());
    const int dxLimit = GetSystemMetrics(SM_CXDOUBLECLK);
    const int dyLimit = GetSystemMetrics(SM_CYDOUBLECLK);
    const int dx = abs(pt.x - lastPt.x);
    const int dy = abs(pt.y - lastPt.y);

    if (lastClickTick != 0 &&
        (now - lastClickTick) <= dblTime &&
        dx <= dxLimit && dy <= dyLimit) {
      detected = true;
      g_desktopDblClickPending.store(true);
      lastClickTick = 0;
    } else {
      lastClickTick = now;
      lastPt = pt;
    }
  }
  prevDown = down;
  return Napi::Boolean::New(env, detected);
}

Napi::Value IsLeftMouseButtonDown(const Napi::CallbackInfo& info) {
  const bool down = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
  return Napi::Boolean::New(info.Env(), down);
}

static Napi::Buffer<uint8_t> HwndToBuffer(Napi::Env env, HWND hwnd) {
  void* p = hwnd;
  return Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&p), sizeof(void*));
}

Napi::Value GetRootHwndAtPoint(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    return env.Null();
  }
  const LONG x = static_cast<LONG>(info[0].As<Napi::Number>().Int32Value());
  const LONG y = static_cast<LONG>(info[1].As<Napi::Number>().Int32Value());
  POINT pt = { x, y };
  HWND hwnd = WindowFromPoint(pt);
  if (!hwnd) return env.Null();
  HWND root = GetAncestor(hwnd, GA_ROOT);
  if (!root) root = hwnd;
  return HwndToBuffer(env, root);
}

// ── Init ─────────────────────────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setFileHiddenQuiet", Napi::Function::New(env, SetFileHiddenQuiet));
  exports.Set("hideFileNow",        Napi::Function::New(env, HideFileNow));
  exports.Set("notifyShellCreate", Napi::Function::New(env, NotifyShellCreate));
  exports.Set("notifyShellDelete", Napi::Function::New(env, NotifyShellDelete));
  exports.Set("notifyShellUpdateItem", Napi::Function::New(env, NotifyShellUpdateItem));
  exports.Set("notifyShellRefreshDesktop", Napi::Function::New(env, NotifyShellRefreshDesktop));
  exports.Set("getFileIconPng",    Napi::Function::New(env, GetFileIconPng));
  exports.Set("startFileDrag",     Napi::Function::New(env, StartFileDrag));
  exports.Set("getWindowClassUnderCursor", Napi::Function::New(env, GetWindowClassUnderCursor));
  exports.Set("registerDropTarget", Napi::Function::New(env, RegisterDropTarget));
  exports.Set("revokeDropTarget",   Napi::Function::New(env, RevokeDropTarget));
  exports.Set("setDesktopIconsVisible", Napi::Function::New(env, SetDesktopIconsVisible));
  exports.Set("registerDesktopPeekHook", Napi::Function::New(env, RegisterDesktopPeekHook));
  exports.Set("unregisterDesktopPeekHook", Napi::Function::New(env, UnregisterDesktopPeekHook));
  exports.Set("consumeDesktopDoubleClick", Napi::Function::New(env, ConsumeDesktopDoubleClick));
  exports.Set("pollDesktopDoubleClick", Napi::Function::New(env, PollDesktopDoubleClick));
  exports.Set("isLeftMouseButtonDown", Napi::Function::New(env, IsLeftMouseButtonDown));
  exports.Set("getRootHwndAtPoint", Napi::Function::New(env, GetRootHwndAtPoint));
  return exports;
}

NODE_API_MODULE(shell_utils, Init)
