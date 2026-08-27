using UnityEngine;
using UnityEditor;

namespace CampaignV2
{
    [CustomEditor(typeof(CampaignV2.SolarSystem))]
    [CanEditMultipleObjects]
    public class SolarSystemEditor : Editor
    {
        public override void OnInspectorGUI()
        {
            base.OnInspectorGUI();
            // Draw the default Inspector (this ensures the usual Inspector fields are shown)
            //DrawDefaultInspector();

            // Get a reference to the script we are inspecting

            // Create a button in the Inspector
            if (GUILayout.Button("Generate connections"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignV2.SolarSystem)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.PopulateBackConnections();
                }
            }

            if (GUILayout.Button("Generate planetIds"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignV2.SolarSystem)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.GeneartePlanetIds();
                }
            }
            
            if (GUILayout.Button("Generate ship Ids"))
            {
                // For each target object selected
                foreach (var targetObj in targets)
                {
                    var myScript = (CampaignV2.SolarSystem)targetObj;

                    // Call a method on the script when the button is clicked
                    myScript.GenerateDummyShips();
                }
            }
        }

    }
}