import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

function MonacoEditor({ fileModels, currentFile, isEditable }) {
  const editorContainerRef = useRef(null);
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorContainerRef.current && !editorRef.current) {
      editorRef.current = monaco.editor.create(editorContainerRef.current, {
        theme: 'vs-dark',
        automaticLayout: true,
        readOnly: true,
        minimap: { enabled: false }
      });
    }

    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (editorRef.current && currentFile && fileModels.has(currentFile)) {
      editorRef.current.setModel(fileModels.get(currentFile));
      editorRef.current.updateOptions({ readOnly: !isEditable });
    } else if (editorRef.current) {
      editorRef.current.setModel(null);
    }
  }, [currentFile, fileModels, isEditable]);

  return <div id="editor-container" ref={editorContainerRef}></div>;
}

export default MonacoEditor;
