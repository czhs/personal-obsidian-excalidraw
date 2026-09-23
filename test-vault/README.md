# Excalidraw code-block test vault

This isolated vault contains the locally built Excalidraw fork.

## Test procedure

1. Open the command palette and run **Excalidraw: New drawing**.
2. On the drawing canvas, either:
   - press **Cmd+Shift+C** on macOS or **Ctrl+Shift+C** elsewhere,
   - open the command palette and run **Excalidraw: Insert code block**, or
   - right-click the canvas and select **Insert code block**.
3. Confirm that an empty code block appears at the pointer with its editor focused immediately.
4. Type or paste code. Use the header selector to switch between **Python**, **C++**, and **SystemVerilog**.
5. Check automatic bracket/quote pairing, Enter indentation, Tab/Shift-Tab, syntax highlighting, completion, undo/redo, moving, resizing, and reopening. Use the compact **AC** control in the block header to toggle autocomplete for that block.

The code remains local. The plugin stores it in the Excalidraw element's scene data and does not execute it.

## Suggested snippets

### Python / NumPy / PyTorch

```python
import numpy as np
import torch

x = torch.tensor(np.arange(8), dtype=torch.float32)
y = torch.nn.functional.relu(x - 3)
print(y)
```

### C++

```cpp
#include <vector>

int main() {
  std::vector<int> values{1, 2, 3};
  return values.size() == 3 ? 0 : 1;
}
```

### SystemVerilog

```verilog
module counter(input logic clk, reset_n, output logic [7:0] count);
  always_ff @(posedge clk or negedge reset_n) begin
    if (!reset_n) count <= '0;
    else count <= count + 1'b1;
  end
endmodule
```
