using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;

public class ShipMapIcon : MonoBehaviour
{

    public MeshRenderer meshRenderer;
    public Transform model;
    public Vector3 shipOffset;
    
    [Header("Scaliing Controls")]
    public AnimationCurve NlipsScaling;
    public float maxScale = 4;

    public void SetFleetData(int numberOfShips, FactionInfo shipFaction)
    {
        meshRenderer.material = shipFaction.factionHologramMaterial;

        for(int i = 0; i < numberOfShips - 1; i++)
        {
            var modelClone = Instantiate(model, transform);
            modelClone.localPosition += shipOffset * i;
        }
    }

    // Start is called before the first frame update
    void Start()
    {
        ZoomEvent zoomEvent = (float zoomLevel) => UpdateScale(zoomLevel);
        var gm = CampaignV2.CampaignMap.Instance;
        gm.camController.zoomeEvents += zoomEvent;
    }

    public void UpdateScale(float scaleRatio)
    {
        float interpretadScale = NlipsScaling.Evaluate(scaleRatio);
        float newScale = 1 + interpretadScale * maxScale;
        model.localScale = Vector3.one * newScale;
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
