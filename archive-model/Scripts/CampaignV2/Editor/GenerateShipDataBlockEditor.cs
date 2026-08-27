using UnityEngine;
using UnityEditor;

[CustomEditor(typeof(GenerateShipDataBlock))]
public class GenerateShipDataBlockEditor : Editor
{
    public override void OnInspectorGUI()
    {
        base.OnInspectorGUI();

        if (GUILayout.Button("Copy Ship Data"))
        {
            var myScript = (GenerateShipDataBlock)target;
            myScript.CopyOverShipData(myScript.defaultShipPrefabONLY);

        }

    }
}