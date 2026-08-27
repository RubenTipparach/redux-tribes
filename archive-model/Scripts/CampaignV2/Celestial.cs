using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using CampaignV2;
using UnityEditor;
using UnityEngine;

public enum CelestialType {
    Unknown = 0,
    Star = 1,
    Planet = 2
}

public class Celestial : MonoBehaviour
{
    public Transform[] dockPoints;
    public Transform stationPoint; // stars have no stations.
    //[HideInInspector]
    public GameObject[] dockingSpots;

    public int dockingSpotsTaken = 0;

    // controlling faction owns starbase and planet
    public ShipFaction factionControl;

    // any number of battlegroups can be stationed
    public List<BattleGroup> battleGroups;
    public string guid;
    public bool hasStation = false;
    public bool visited = false;

    public CelestialDataUI celestialDataUI;

    public EncounterType encounterType;

    public virtual string LocationName
    {
        get;
    }

    public virtual CampaignV2.SolarSystem system
    {
        get;
    }

    public bool IsHostile
    {
        get
        {
            // TODO: create a a diplomacy matrix.
            return CampaignMenu.Instance.myFaction.shipFaction != factionControl;
        }
    }

    public bool HasShips
    {
        get
        {
            // TODO: create a a diplomacy matrix.
            return battleGroups != null && battleGroups.Count > 0;
        }
    }

    public CelestialType Type
    {
        get
        {
            if (this is CampaignV2.Planet)
            {
                return CelestialType.Planet;
            }
            else if (this is CampaignV2.SolarSystem)
            {
                return CelestialType.Star;
            }
            else
            {
                return CelestialType.Unknown;
            }
        }
    }

    public virtual bool IsAdjacentToSolarSystem(CampaignV2.SolarSystem other)
    {
        return other.systemConnections.Contains(system) // just need to be one or the other
            || system.systemConnections.Contains(other)
            || other == system;
    }
    private void Awake()
    {
        // if(dockingSpots == null || dockingSpots.Length == 0)
        // {
        //     dockingSpots = new GameObject[dockPoints.Length];
        // }
        if (this.gameObject.name.Contains(this.guid))
        {
            this.gameObject.name = this.gameObject.name + "-" + this.guid;
        }
    }



    public Transform EnterDockingSpot(GameObject obj)
    {
        if (dockingSpots == null || dockingSpots.Length == 0)
        {
            dockingSpots = new GameObject[dockPoints.Length];
        }

        for (int i = 0; i < dockingSpots.Length; i++)
        {
            if (dockingSpots[i] == null)
            {
                dockingSpots[i] = obj;
                dockingSpotsTaken += 1;
                return dockPoints[i];
            }
        }
        return null;
    }


    public Transform NextOpenSpot()
    {
        for (int i = 0; i < dockingSpots.Length; i++)
        {
            if (dockingSpots[i] == null)
            {
                return dockPoints[i];
            }
        }
        return dockPoints[0];// if its full...
    }

    public Vector3 ClosestOpenDockingSpot
    {
        get
        {
            return dockPoints[Mathf.Max(dockingSpotsTaken, dockingSpots.Length - 1)].position;
        }
    }


    public void LeaveDockingSpot(GameObject obj)
    {
        var index = Array.IndexOf(dockingSpots, obj);
        Debug.Log("removing from index: " + index);
        if (index == -1) return;
        dockingSpotsTaken -= 1;
        dockingSpots[index] = null;
        //todo reorganize all ships, just snap them together.
    }
    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {

    }


#if UNITY_EDITOR
    private void OnDrawGizmos()
    {
        Gizmos.color = Color.white;
        if (stationPoint != null)
        {
            Gizmos.DrawWireCube(stationPoint.position, Vector3.one * 0.15f);
        }

        foreach (var c in dockPoints)
        {
            if (c != null)
            {
                Gizmos.color = Color.blue;
                Gizmos.DrawWireCube(c.position, Vector3.one * 0.1f);
                Gizmos.color = Color.red;
                Gizmos.DrawLine(c.position, stationPoint.position);
            }
        }

        Handles.Label(transform.position + Vector3.up * 2.5f, transform.name);
        Handles.Label(transform.position + Vector3.up * 2.25f, factionControl.ToString());
        Handles.Label(transform.position + Vector3.up * 2.0f, encounterType.ToString());
        Handles.Label(transform.position + Vector3.up * 1.75f, GetBattleGroupInfo());
    }

    public void InitializeFromUI(FactionInfoLibrary factionInfoLibrary)
    {
        Debug.Log($"{system.LocationName}>>>{LocationName}");
        EditorUtility.SetDirty(celestialDataUI.flagImage);
        SetupFaction(factionInfoLibrary, InitializeFromUI: true);
        PrefabUtility.RecordPrefabInstancePropertyModifications(celestialDataUI.flagImage);
    }
#endif

    public void SetupFaction(FactionInfoLibrary factionInfoLibrary, bool InitializeFromUI)
    {
        var flagSprite = factionInfoLibrary.GetFactionInfo(factionControl).factionIcon;
        var mission = "";

        if (IsHostile && HasShips && !InitializeFromUI)
        {
            mission = CampaignMap.Instance.mapsTable[encounterType].MissionTitle;
        }
        string battleGroupText = GetBattleGroupInfo();
        celestialDataUI.SetInfo(flagSprite, LocationName, mission, battleGroupText);

    }

    public string GetBattleGroupInfo()
    {
        return battleGroups.Count == 0 ? "" : "Fleets: " + string.Join(" ", battleGroups.Select(p => $"[{p.ships.Count}]"));
    }
}

