using UnityEngine;
using UnityEditor;

namespace CampaignV2
{
    [CustomEditor(typeof(CampaignV2.CampaignMap))]
    //[CanEditMultipleObjects]
    public class CampaignMapEditor : Editor
    {
        public override void OnInspectorGUI()
        {
             base.OnInspectorGUI();
            // Draw the default Inspector (this ensures the usual Inspector fields are shown)
           //DrawDefaultInspector();

            // Get a reference to the script we are inspecting

            // Create a button in the Inspector
            if (GUILayout.Button("Generate UUIDs"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignMap)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.GenearteIds();
                }
            }

            GUILayout.Label("Warning! This area will override save data!");
            if (GUILayout.Button("Populate Default Ships"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignMap)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.GenerateDummyShips();
                }
            }

            if (GUILayout.Button("Generate New Save File"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignMap)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.GenerateSaveData();
                }
            }
        }

    }
}