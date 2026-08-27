using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Shapes;

public class CampaignMapOverlay : MonoBehaviour
{

    public ShapeSpaceUtilities shapeSpaceUtilities;
    public CustomLineProperties navLineProperties;

    CampaignV2.CampaignMap gm;
    // Start is called before the first frame update
    void Start()
    {
        shapeSpaceUtilities.drawCmd += DrawStuff;

        gm = CampaignV2.CampaignMap.Instance;
        
    }

    void DrawStuff(){
        if (navLineProperties == null) return;

        navLineProperties.DrawNormal();
        navLineProperties.DrawDots();
        Draw.Color = navLineProperties.color;

        var ship = gm.playerShip;

        if (ship.atLocation != null && ship.selectedLocation != null)
        {
            Draw.Line(ship.atLocation.transform.position, ship.selectedLocation.transform.position);
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
