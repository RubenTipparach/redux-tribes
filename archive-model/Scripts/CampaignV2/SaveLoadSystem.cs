using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;

public class SaveLoadSystem : MonoBehaviour
{
    public void SaveGame(
         CampaignV2.SolarSystem[] stars,
         int credits,
         FactionInfo playerFaction,
         List<ShipSave> playerFleet,
         Dictionary<ShipFaction, FactionStatus> factionRepState,
         CampaignSaveFile campaignSaveFile // cannot be null!
         //,bool initial = false
         )
    {
        var generateShipDataBlock = CampaignV2.CampaignMap.Instance.generateShipDataBlock;

        campaignSaveFile.credits = credits;
        campaignSaveFile.shipFaction = playerFaction.shipFaction;
        // fleetPanel.money.text = $"$ {credits}";
        // stars status
        campaignSaveFile.starSaveData = stars.Select(p =>
            new StarSaveData()
            {
                //todo need starId
                starId = p.guid,
                controllingFaction = p.factionControl,
                //garrisonStr = p.garrisonStrength,
                planetSaveData = p.planets.Select(q =>
                    new PlanetSaveData
                    {
                        planetId = q.guid,
                        // garrisonFleet = new GarrisonFleet
                        // {
                        //     Gunships = q.garrisonFleet.Gunships,
                        //     Frigates = q.garrisonFleet.Frigates,
                        //     Destroyers = q.garrisonFleet.Destroyers,
                        //     BattleShips = q.garrisonFleet.BattleShips,
                        // },
                        controllingFaction = q.factionControl,
                        hasStation = q.hasStation,
                        //hasGarrison = q.hasGarrison,
                        visited = q.visited,
                        planetType = q.planetType,
                        surfaceType = q.surfaceType,
                        atmosphereType = q.atmosphereType
                    }).ToArray()

            }
        ).ToArray();

        // ships status
        //if (initial)
        //{
            //campaignSaveFile.shipSave = new ShipSave[] { generateShipDataBlock.shipSave_default };
            //Debug.Log("initial save file!");
            //playerFleet = campaignSaveFile.shipSave.ToList();
        //}
        //else
        //{
        campaignSaveFile.shipSave = playerFleet.ToArray();
        Debug.Log("continuing save file!");
        //}

        //campaignSaveFile.currentStarId = navigationPanel.starmapShip.selectedStar.ID;// todo replace with name

        // reputation status
        campaignSaveFile.reputationSave = factionRepState.Select(p => new ReputationSave()
        {
            shipFaction = p.Key,
            reputationScore = p.Value.factionScore
        }).ToArray();
        
        var shipString = string.Join(',', campaignSaveFile.shipSave.Select(p =>
            JsonUtility.ToJson(p)));
        Debug.Log($"Save game - logging ship status: {shipString}");

        CampaignSaveSystem.Save(campaignSaveFile); // todo update this!
    }

    public CampaignSaveFile LoadGame(){

        Debug.Log($"Saving.. {CampaignSaveSystem.savePath}");
        var campaignSaveFile = CampaignSaveSystem.Load();
        if (campaignSaveFile == null)
        {
            campaignSaveFile = new CampaignSaveFile();
            //currentStarId = navigationPanel.starmapShip.selectedStar.ID;
            // initialize stuff here!
            //SaveGame();

            Debug.Log("no campaign detected, so I made a new one");


        }
        else
        {
            //campaignSaveFile = new CampaignSaveFile();
            // being populating stuff.
            var shipString = string.Join(',', campaignSaveFile.shipSave.Select(p =>
                JsonUtility.ToJson(p)));
            Debug.Log($"Load Game - Campaign save file found!  {shipString}");


        }

        // delay the start so ui elements can be setup
        StartCoroutine(DelayedStarLoad());
        return campaignSaveFile;
    }

    IEnumerator DelayedStarLoad()
    {
        yield return new WaitForEndOfFrame();
        //navigationPanel.starmapShip.SetCurrentStar(currentStarId);

        // foreach (var loadedStar in campaignSaveFile.starSaveData)
        // {
        //     navigationPanel.findStarById(loadedStar.starId).SetGarrisonStr(loadedStar.garrisonStr);
        // }

    }

    public void ResetCampaignSave()
    {
        CampaignSaveSystem.DeleteSaveFile();
    }

}
