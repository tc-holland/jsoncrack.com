import React, { useEffect, useState } from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, TextInput, Group } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";

// pure helpers at module scope
const parsePrimitive = (v: string) => {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (v === "") return "";
  const n = Number(v);
  if (!Number.isNaN(n) && String(n) === v) return n;
  return v;
};

/**
 * Mutates `obj` by setting `replacement` at `path`.
 * If path is empty/undefined, returns replacement (caller should use it as the new root).
 */
const setValueAtPath = (obj: any, path: (string | number)[] | undefined, replacement: any) => {
  if (!path || path.length === 0) {
    return replacement;
  }

  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const nextSeg = path[i + 1];
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) {
        // if current isn't array, coerce into array
        cur = [];
      }
      if (cur[seg] == null) {
        // decide next container type based on next segment
        cur[seg] = typeof nextSeg === "number" ? [] : {};
      }
      cur = cur[seg];
    } else {
      if (cur[seg] == null || typeof cur[seg] !== "object") {
        cur[seg] = typeof nextSeg === "number" ? [] : {};
      }
      cur = cur[seg];
    }
  }

  const last = path[path.length - 1];
  cur[last as any] = replacement;
  return obj;
};

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj: Record<string, unknown> = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  // populate form when editing starts or node changes
  useEffect(() => {
    if (!isEditing || !nodeData) {
      setForm({});
      return;
    }

    // primitive single value
    if (nodeData.text?.length === 1 && !nodeData.text[0].key) {
      setForm({ "": String(nodeData.text[0].value ?? "") });
      return;
    }

    const values: Record<string, string> = {};
    nodeData.text?.forEach(r => {
      if (r.type !== "array" && r.type !== "object" && r.key) {
        values[r.key] = String(r.value ?? "");
      }
    });
    setForm(values);
  }, [isEditing, nodeData]);

  const startEditing = () => setIsEditing(true);
  const cancelEditing = () => setIsEditing(false);

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    if (!nodeData) return;

    // build new rows by applying form values to existing rows
    const newRows = nodeData.text?.map(r => {
      if (r.type !== "array" && r.type !== "object" && r.key && Object.prototype.hasOwnProperty.call(form, r.key)) {
        return { ...r, value: form[r.key] };
      }
      // handle primitive single-value node
      if (r.key == null && Object.prototype.hasOwnProperty.call(form, "")) {
        return { ...r, value: form[""] };
      }
      return r;
    }) ?? [];

    // update graph store selected node if updater exists
    const store = useGraph.getState() as any;
    const updater = store.updateSelectedNode ?? store.setSelectedNode ?? store.updateNode ?? store.setNode;
    if (typeof updater === "function") {
      updater({ ...nodeData, text: newRows });
    }

    // Persist changes into the JSON text (so editor + graph re-sync)
    try {
      const raw = useJson.getState().getJson();
      const root = raw ? JSON.parse(raw) : {};

      // build replacement value for this node
      let replacement: any;
      if (nodeData.text?.length === 1 && nodeData.text[0].key == null) {
        // primitive single value
        replacement = parsePrimitive(form[""] ?? String(newRows[0]?.value ?? ""));
      } else {
        // build object from form entries
        const obj: Record<string, any> = {};
        Object.entries(form).forEach(([k, v]) => {
          obj[k] = parsePrimitive(v);
        });
        replacement = obj;
      }

      // operate on a deep clone
      const newRoot = JSON.parse(JSON.stringify(root));
      const final = setValueAtPath(newRoot, nodeData.path, replacement);

      // if path was empty, final is the replacement itself
      const toSave = (nodeData.path && nodeData.path.length > 0) ? final : replacement;

      useJson.getState().setJson(JSON.stringify(toSave, null, 2));
    } catch (err) {
      // keep modal open and log error; optionally show a toast
      // eslint-disable-next-line no-console
      console.error("Failed to persist node edits to JSON:", err);
    }

    // stop editing but keep modal open
    setIsEditing(false);
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group gap="xs">
              {/* Edit button (blue) */}
              <Button color="blue" size="xs" onClick={startEditing} disabled={isEditing || !nodeData}>
                Edit
              </Button>

              {/* existing close button */}
              <CloseButton onClick={onClose} />
            </Group>
          </Flex>

          {/* View mode */}
          {!isEditing && (
            <ScrollArea.Autosize mah={250} maw={600}>
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            </ScrollArea.Autosize>
          )}

          {/* Edit mode */}
          {isEditing && (
            <Stack gap="sm">
              <ScrollArea.Autosize mah={300} maw={600}>
                <Stack gap="xs">
                  {/* If primitive single value, use empty-string key in form. Otherwise render each attribute as a TextInput. */}
                  {Object.keys(form).length === 0 && <Text fz="sm">No editable attributes</Text>}

                  {Object.entries(form).map(([key, val]) => (
                    <TextInput
                      key={key}
                      label={key === "" ? "Value" : key}
                      value={val}
                      onChange={e => handleChange(key, e.currentTarget.value)}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>

              <Flex gap="sm" justify="flex-end">
                <Button variant="outline" size="xs" onClick={cancelEditing}>
                  Cancel
                </Button>
                <Button color="blue" size="xs" onClick={handleSave}>
                  Save
                </Button>
              </Flex>
            </Stack>
          )}
        </Stack>

        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
