export function clearModels(group, models) {
  for (const model of models) {
    group.remove(model.mesh);
    model.mesh.geometry.dispose();
    if(model.source && model.source !== model.mesh.geometry) model.source.dispose();
    if(model.refined && model.refined !== model.mesh.geometry) model.refined.dispose();
    model.mesh.material.dispose();
  }
  models.length = 0;
}

// Only the latest selection may add meshes or update the loading state.
export function createModelImporter({ clear, add, onStart, onFinish, onError }) {
  let generation = 0;
  return async function importFiles(files, companions, refinements) {
    if (!files.length) return;
    const current = ++generation;
    clear();
    onStart();
    let added = 0;
    for (const file of files) {
      if (current !== generation) return;
      if (!/\.(stl|obj)$/i.test(file.name)) {
        onError(`${file.name}：仅支持 STL / OBJ 文件`);
        continue;
      }
      if (file.size > 150 * 1024 * 1024) {
        onError(`${file.name}：文件超过 150 MB`);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        if (current !== generation) return;
        let result;
        if (companions) {
          const companion = companions.get(file);
          if (!companion) throw new Error('缺少同名分牙 JSON 文件');
          result = JSON.parse(await companion.text());
          if (current !== generation) return;
        }
        add(buffer, file.name, result, refinements?.get(file));
        added++;
      } catch (error) {
        if (current !== generation) return;
        onError(`${file.name}：${error.message}`);
      }
    }
    onFinish(added);
  };
}
