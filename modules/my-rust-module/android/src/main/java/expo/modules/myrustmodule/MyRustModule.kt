package expo.modules.myrustmodule

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.math.add

class MyRustModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MyRustModule")

    Function("hello") {
      "Hello from Rust! 40 + 2 = ${add(40, 2)}"
    }
  }
}
