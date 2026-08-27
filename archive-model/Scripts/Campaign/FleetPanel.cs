using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class FleetPanel : MonoBehaviour, ICampaignPanel
{


    public ShipManagerUnit template;

    public List<ShipManagerUnit> shipManagerUnits;

    public Image shipSelectedImage;

    public Transform shipsPanel;

    public ShipManagerUnit selectedShip;

    public ShipSelectedPanel shipSelectedPanel;

    public TextMeshProUGUI money;

    public void Close()
    {
        Debug.Log("fleet panel closed " + shipManagerUnits.Count );
        ClearShips();
        gameObject.SetActive(false);
        Debug.Log("fleet panel cleanup " + shipManagerUnits.Count );
    }
    
    public ICampaignPanel Open()
    {
        Debug.Log("fleet panel opened");
        gameObject.SetActive(true);

        //ClearShips();
        shipManagerUnits = new List<ShipManagerUnit>();
        var ships = CampaignMenu.Instance.MyShips;

        foreach(var ship in ships)
        {
            var unit = Instantiate(template, shipsPanel);
            unit.Init(ship);
            shipManagerUnits.Add(unit);
        }

        if(selectedShip == null)
        {
            shipSelectedImage.enabled = false;
        }

        return this;
    }

    private void ClearShips()
    {
        if (shipManagerUnits != null &&  shipManagerUnits.Count > 0)
        {
            for (int i = shipManagerUnits.Count - 1; i >= 0; i--)
            {
                //Debug.Log("clean up ship " + i);
                Destroy(shipManagerUnits[i].gameObject);
                shipManagerUnits.Remove(shipManagerUnits[i]);
            }
        }
    }

    private void OnEnable() {
        Debug.Log("fleet panel enabled");
    }

    public void SelectShip(ShipManagerUnit shipManagerUnit)
    {
        ClearSelection();
        selectedShip = shipManagerUnit;
        shipSelectedImage.enabled = true;
        shipSelectedImage.sprite = shipManagerUnit.shipImage.sprite;
        shipSelectedImage.color = shipManagerUnit.shipCardData.factionColor;
        shipSelectedPanel.SetShipSave(shipManagerUnit.ShipData, shipManagerUnit);

    }

    private void ClearSelection(){
        selectedShip?.Deselect();
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
