using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MissionSaveLoadHelper : MonoBehaviour
{
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public static void LoadShips(CampaignSaveFile campaignSaveFile, List<ShipController> playerShips)
    {
        
    }

    public static void SaveShips(List<ShipController> playerShips, CampaignSaveFile saveFile){
        var ships = new List<ShipSave>();
        foreach (var target in playerShips)
        {
            var ship = GenerateShipDataBlock.CopyOverShipDataBlock(target, initial: false);

            ships.Add(ship);
        }

        saveFile.shipSave = ships.ToArray();
    }
}
