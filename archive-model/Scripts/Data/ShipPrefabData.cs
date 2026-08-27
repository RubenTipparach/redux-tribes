using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "ShipPrefabData", menuName = "ShipData/ShipPrefabData", order = 0)]
public class ShipPrefabData : ScriptableObject
{
    public ShipFaction shipFaction;
    public ShipType shipType;

    public string shipVariant = "A";

    public GameObject shipControllerPrefab;
}