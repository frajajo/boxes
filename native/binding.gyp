{
  "targets": [
    {
      "target_name": "shell_utils",
      "sources": [ "src/shell_utils.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "libraries": [ "-lshell32", "-lole32", "-loleaut32", "-lshlwapi" ],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/std:c++17" ]
            }
          }
        }]
      ]
    }
  ]
}
