using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

[CreateAssetMenu(fileName = "ShipFaction", menuName = "ShipData/ShipFaction", order = 0)]
public class FactionInfo : ScriptableObject
{
    public ShipFaction shipFaction;

    public string factionName;
    public string factionDesignation;
    public Sprite factionIcon;

    public ShipCardData defaultShip;

    public ShipCardData[] allShips;

    public Material factionHologramMaterial;
    public Color primaryFactionColor;
    public Color secondaryFactionColor;

    public ShipCardData GetShip(string id){
        return allShips.FirstOrDefault(p => p.id == id);
    }
}